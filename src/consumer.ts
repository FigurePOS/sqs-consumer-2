import { AWSError } from "aws-sdk"
import * as SQS from "aws-sdk/clients/sqs"
import { PromiseResult } from "aws-sdk/lib/request"
import { EventEmitter } from "events"
import { autoBind } from "./bind"
import { SQSError, TimeoutError } from "./errors"
import {
    createTimeout,
    getNextPendingMessage,
    groupMessageBatchByArrivedTime,
    isConnectionError,
    isPollingReadyForNextReceive,
    toSQSError,
} from "./utils"
import { ConsumerOptions, Events, PendingMessage, PendingMessages, SQSMessage } from "./types"

type ReceiveMessageResponse = PromiseResult<SQS.Types.ReceiveMessageResult, AWSError>
type ReceiveMessageRequest = SQS.Types.ReceiveMessageRequest

export class Consumer extends EventEmitter {
    private readonly queueUrl: string
    private readonly handleMessage: (message: SQSMessage) => Promise<void>
    private readonly handleMessageTimeout: number | null
    private readonly attributeNames: string[]
    private readonly messageAttributeNames: string[]
    private readonly batchSize: number
    private readonly visibilityTimeout: number | null
    private readonly waitTimeSeconds: number
    private readonly authenticationErrorTimeout: number
    private readonly pollingWaitTimeMs: number
    private readonly terminateVisibilityTimeout: boolean
    private readonly heartbeatInterval: number
    private readonly sqs: SQS
    private readonly pendingMessages: PendingMessages

    private stopped: boolean
    private pollingStopped: boolean
    private heartbeatTimeout: NodeJS.Timeout

    constructor(options: ConsumerOptions) {
        super()
        this.queueUrl = options.queueUrl
        this.handleMessage = options.handleMessage
        this.handleMessageTimeout = options.handleMessageTimeout
        this.attributeNames = Array.from(new Set([...(options.attributeNames || []), "MessageGroupId"]))
        this.messageAttributeNames = options.messageAttributeNames || ["All"]
        this.stopped = true
        this.pollingStopped = true
        this.batchSize = options.batchSize || 10
        this.visibilityTimeout = options.visibilityTimeout || 30
        this.terminateVisibilityTimeout = options.terminateVisibilityTimeout || false
        this.heartbeatInterval = options.heartbeatInterval || 5
        this.waitTimeSeconds = options.waitTimeSeconds || 20
        this.authenticationErrorTimeout = options.authenticationErrorTimeout || 10000
        this.pollingWaitTimeMs = options.pollingWaitTimeMs || 10
        this.pendingMessages = []

        this.sqs =
            options.sqs ||
            new SQS({
                region: options.region || process.env.AWS_REGION || "us-east-1",
            })

        this.assertOptions()
        autoBind(this)
    }

    private assertOptions(): void {
        if (this.batchSize < 1) {
            throw new Error("SQS batchSize option must be greater than zero.")
        }
        if (this.heartbeatInterval != null && this.heartbeatInterval >= this.visibilityTimeout) {
            throw new Error("heartbeatInterval must be less than visibilityTimeout.")
        }
    }

    emit<T extends keyof Events>(event: T, ...args: Events[T]) {
        return super.emit(event, ...args)
    }

    on<T extends keyof Events>(event: T, listener: (...args: Events[T]) => void): this {
        return super.on(event, listener)
    }

    once<T extends keyof Events>(event: T, listener: (...args: Events[T]) => void): this {
        return super.once(event, listener)
    }

    public get isRunning(): boolean {
        return !this.stopped
    }

    public static create(options: ConsumerOptions): Consumer {
        return new Consumer(options)
    }

    public start(): void {
        if (this.stopped) {
            this.stopped = false
            this.pollSqs()
            this.startHeartbeat()
        }
    }

    public stop(): void {
        this.stopped = true
        this.stopHeartbeat()
    }

    private pollSqs(): void {
        if (this.stopped) {
            this.emit("stopped")
            return
        }

        this.pollingStopped = false

        const receiveParams = {
            QueueUrl: this.queueUrl,
            AttributeNames: this.attributeNames,
            MessageAttributeNames: this.messageAttributeNames,
            MaxNumberOfMessages: Math.min(10, this.batchSize),
            WaitTimeSeconds: this.waitTimeSeconds,
            ...(this.visibilityTimeout ? { VisibilityTimeout: this.visibilityTimeout } : null),
        }

        let currentPollingTimeout = this.pollingWaitTimeMs
        this.receiveMessage(receiveParams)
            .then(this.addToPendingMessages)
            .catch((err) => {
                this.emit("error", err)
                if (isConnectionError(err)) {
                    currentPollingTimeout = this.authenticationErrorTimeout
                }
                return
            })
            .then(() => {
                if (!this.stopped && isPollingReadyForNextReceive(this.batchSize, this.pendingMessages.length)) {
                    setTimeout(this.pollSqs, currentPollingTimeout)
                } else {
                    this.pollingStopped = true
                }
            })
            .catch((err) => {
                this.emit("error", err)
            })
    }

    private addToPendingMessages(response: ReceiveMessageResponse): Promise<void> {
        if (!response || !response.Messages) {
            return
        }
        if (response.Messages.length === 0) {
            if (this.pendingMessages.length === 0) {
                this.emit("empty")
            }
            return
        }

        const current = Date.now()
        const batch: PendingMessage[] = response.Messages.map((message) => ({
            sqsMessage: message,
            processing: false,
            arrivedAt: current,
            processingStartedAt: null,
        }))

        this.pendingMessages.push(...batch)

        this.processNextPendingMessage()
    }

    private processNextPendingMessage(): void {
        const message = getNextPendingMessage(this.pendingMessages)
        if (!message) {
            return
        }

        message.processing = true
        message.processingStartedAt = Date.now()

        this.processMessage(message).then(() => {
            setImmediate(this.processNextPendingMessage)

            if (this.pollingStopped && isPollingReadyForNextReceive(this.batchSize, this.pendingMessages.length)) {
                setImmediate(this.pollSqs)
            }
        })

        setImmediate(this.processNextPendingMessage)
    }

    private async processMessage(message: PendingMessage): Promise<void> {
        const sqsMsg = message.sqsMessage

        this.emit("message_received", sqsMsg)

        try {
            await this.executeHandler(sqsMsg)

            const processedTime = Date.now()

            await this.deleteMessage(sqsMsg)

            this.emit("message_processed", sqsMsg, {
                arrivedAt: message.arrivedAt,
                processingStartedAt: message.processingStartedAt,
                processedAt: processedTime,
                waitingTime: message.processingStartedAt - message.arrivedAt,
                processingTime: processedTime - message.processingStartedAt,
                totalTime: processedTime - message.arrivedAt,
                messagesProcessing: this.pendingMessages.filter((m) => m.processing === true).length,
                messagesWaiting: this.pendingMessages.filter((m) => m.processing === false).length,
            })
        } catch (err) {
            this.emitError(err, sqsMsg)

            if (this.terminateVisibilityTimeout) {
                await this.changeVisibilityTimeout(sqsMsg, 0)
            }
        }
    }

    private async receiveMessage(params: ReceiveMessageRequest): Promise<ReceiveMessageResponse> {
        try {
            return await this.sqs.receiveMessage(params).promise()
        } catch (err) {
            throw toSQSError(err, `SQS receive message failed: ${err.message}`)
        }
    }

    private async deleteMessage(message: SQSMessage): Promise<void> {
        const deleteParams = {
            QueueUrl: this.queueUrl,
            ReceiptHandle: message.ReceiptHandle || "",
        }

        try {
            // delete from pending messages
            const messageIndex = this.pendingMessages.findIndex((m) => m.sqsMessage.MessageId === message.MessageId)
            this.pendingMessages.splice(messageIndex, 1)

            await this.sqs.deleteMessage(deleteParams).promise()
        } catch (err) {
            throw toSQSError(err, `SQS delete message failed: ${err.message}`)
        }
    }

    private async executeHandler(message: SQSMessage): Promise<void> {
        let timeout
        try {
            if (this.handleMessageTimeout) {
                timeout = createTimeout(this.handleMessageTimeout)
                await Promise.race([this.handleMessage(message), timeout.pending])
            } else {
                await this.handleMessage(message)
            }
        } catch (err) {
            if (err instanceof TimeoutError) {
                err.message = `Message handler timed out after ${this.handleMessageTimeout}ms: Operation timed out.`
            } else {
                err.message = `Unexpected message handler failure: ${err.message}`
            }
            throw err
        } finally {
            if (timeout && timeout.timeout) {
                clearTimeout(timeout.timeout)
            }
        }
    }

    private async changeVisibilityTimeout(message: SQSMessage, timeout: number): Promise<PromiseResult<any, AWSError>> {
        try {
            return await this.sqs
                .changeMessageVisibility({
                    QueueUrl: this.queueUrl,
                    ReceiptHandle: message.ReceiptHandle || "",
                    VisibilityTimeout: timeout,
                })
                .promise()
        } catch (err) {
            this.emit("error", err, message)
        }
    }

    private emitError(err: Error, message: SQSMessage): void {
        if (err.name === SQSError.name) {
            this.emit("error", err, message)
        } else if (err instanceof TimeoutError) {
            this.emit("timeout_error", err, message)
        } else {
            this.emit("processing_error", err, message)
        }
    }

    private async changeVisibilityTimeoutBatch(
        messages: SQSMessage[],
        timeout: number,
    ): Promise<PromiseResult<any, AWSError>> {
        const params = {
            QueueUrl: this.queueUrl,
            Entries: messages.map((message) => ({
                Id: message.MessageId || "",
                ReceiptHandle: message.ReceiptHandle || "",
                VisibilityTimeout: timeout,
            })),
        }
        try {
            return this.sqs.changeMessageVisibilityBatch(params).promise()
        } catch (err) {
            this.emit("error", err, messages)
        }
    }

    private startHeartbeat(): void {
        this.heartbeatTimeout = setInterval(async () => {
            const now = Date.now()
            const messages = groupMessageBatchByArrivedTime(this.pendingMessages)
            for (const msg of messages) {
                const elapsedSeconds = Math.ceil((now - msg[0].arrivedAt) / 1000)
                await this.changeVisibilityTimeoutBatch(
                    msg.map((a) => a.sqsMessage),
                    elapsedSeconds + (this.visibilityTimeout || 0),
                )
            }
        }, this.heartbeatInterval * 1000)
    }

    private stopHeartbeat(): void {
        clearInterval(this.heartbeatTimeout)
    }
}
