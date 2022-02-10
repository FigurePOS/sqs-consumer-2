import { AWSError } from "aws-sdk"
import * as SQS from "aws-sdk/clients/sqs"
import { PromiseResult } from "aws-sdk/lib/request"
import { EventEmitter } from "events"
import { autoBind } from "./bind"
import { SQSError, TimeoutError } from "./errors"
import { getNextPendingMessage, groupMessageBatchByArrivedTime } from "./utils"

type ReceiveMessageResponse = PromiseResult<SQS.Types.ReceiveMessageResult, AWSError>
type ReceiveMessageRequest = SQS.Types.ReceiveMessageRequest
export type SQSMessage = SQS.Types.Message

interface TimeoutResponse {
    timeout: NodeJS.Timeout | null
    pending: Promise<void>
}

function createTimeout(duration: number): TimeoutResponse {
    let timeout = null
    const pending: Promise<void> = new Promise((_, reject) => {
        timeout = setTimeout((): void => {
            reject(new TimeoutError())
        }, duration)
    })
    return { timeout: timeout, pending: pending }
}

function isConnectionError(err: Error): boolean {
    if (err instanceof SQSError) {
        return err.statusCode === 403 || err.code === "CredentialsError" || err.code === "UnknownEndpoint"
    }
    return false
}

function toSQSError(err: AWSError, message: string): SQSError {
    const sqsError = new SQSError(message)
    sqsError.code = err.code
    sqsError.statusCode = err.statusCode
    sqsError.region = err.region
    sqsError.retryable = err.retryable
    sqsError.hostname = err.hostname
    sqsError.time = err.time

    return sqsError
}

export interface ConsumerOptions {
    queueUrl: string
    attributeNames?: string[]
    messageAttributeNames?: string[]
    stopped?: boolean
    batchSize?: number
    visibilityTimeout?: number
    waitTimeSeconds?: number
    authenticationErrorTimeout?: number
    pollingWaitTimeMs?: number
    terminateVisibilityTimeout?: boolean
    heartbeatInterval?: number
    sqs?: SQS
    region?: string
    handleMessageTimeout?: number
    handleMessage(message: SQSMessage): Promise<void>
}

interface Events {
    response_processed: []
    empty: []
    message_received: [SQSMessage]
    message_processed: [SQSMessage]
    error: [Error, void | SQSMessage | SQSMessage[]]
    timeout_error: [Error, SQSMessage]
    processing_error: [Error, SQSMessage]
    stopped: []
}

export type PendingMessage = {
    sqsMessage: SQSMessage
    processing: boolean
    arrivedAt: number
}

export type PendingMessages = PendingMessage[]

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
    private heartbeatTimeout: NodeJS.Timeout

    constructor(options: ConsumerOptions) {
        super()
        this.queueUrl = options.queueUrl
        this.handleMessage = options.handleMessage
        this.handleMessageTimeout = options.handleMessageTimeout
        this.attributeNames = Array.from(new Set([...(options.attributeNames || []), "MessageGroupId"]))
        this.messageAttributeNames = options.messageAttributeNames || ["All"]
        this.stopped = true
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
                region: options.region || process.env.AWS_REGION || "eu-west-1",
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
                if (this.pendingMessages.length < this.batchSize) {
                    setTimeout(this.pollSqs, currentPollingTimeout)
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
            //this.emit("empty")
            return
        }

        const current = Date.now()
        const batch: PendingMessage[] = response.Messages.map((message) => ({
            sqsMessage: message,
            processing: false,
            arrivedAt: current,
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

        this.processMessage(message.sqsMessage).then(() => {
            setImmediate(this.processNextPendingMessage)
        })

        setImmediate(this.processNextPendingMessage)
    }

    private async processMessage(message: SQSMessage): Promise<void> {
        this.emit("message_received", message)

        try {
            await this.executeHandler(message)
            await this.deleteMessage(message)
            this.emit("message_processed", message)
        } catch (err) {
            this.emitError(err, message)

            if (this.terminateVisibilityTimeout) {
                await this.changeVisibilityTimeout(message, 0)
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
            this.pendingMessages.splice(messageIndex)

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
            return this.sqs
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
            const batches = groupMessageBatchByArrivedTime(this.pendingMessages)
            for (const b of batches) {
                const elapsedSeconds = Math.ceil((now - b[0].arrivedAt) / 1000)
                await this.changeVisibilityTimeoutBatch(
                    b.map((a) => a.sqsMessage),
                    elapsedSeconds + (this.visibilityTimeout || 0),
                )
            }
        }, this.heartbeatInterval * 1000)
    }

    private stopHeartbeat(): void {
        clearInterval(this.heartbeatTimeout)
    }
}
