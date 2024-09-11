import {
    ChangeMessageVisibilityBatchCommand,
    ChangeMessageVisibilityCommand,
    DeleteMessageBatchCommand,
    DeleteMessageCommand,
    Message,
    ReceiveMessageCommand,
    ReceiveMessageRequest,
    ReceiveMessageResult,
    SQSClient,
} from "@aws-sdk/client-sqs"
import { EventEmitter } from "events"
import { autoBind } from "./bind"
import { SQSError, TimeoutError } from "./errors"
import { ConsumerOptions, Events, PendingMessage, PendingMessages, TimeoutResponse } from "./types"
import {
    createTimeout,
    filterOutByGroupId,
    getMessagesByGroupId,
    getNextPendingMessage,
    getNextPendingMessageBatch,
    groupMessageBatchByArrivedTime,
    isConnectionError,
    isFifo,
    isPollingReadyForNextReceive,
    removeMessagesFromPending,
    toSQSError,
} from "./utils"

export class Consumer extends EventEmitter {
    private readonly queueUrl: string
    private readonly handleMessage: (message: Message) => Promise<void>
    private readonly handleMessageBatch: (messages: Message[]) => Promise<void>
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
    private readonly sqs: SQSClient
    private pendingMessages: PendingMessages

    private stopped: boolean
    private pollingStopped: boolean
    private heartbeatTimeout: NodeJS.Timeout

    constructor(options: ConsumerOptions) {
        super()
        if (!options.handleMessage && !options.handleMessageBatch) {
            throw new Error("Missing required handleMessage or handleMessageBatch function.")
        }
        this.queueUrl = options.queueUrl
        this.handleMessage = options.handleMessage
        this.handleMessageBatch = options.handleMessageBatch
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
            new SQSClient({
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

    private addToPendingMessages(response: ReceiveMessageResult) {
        if (!response || !response.Messages || response.Messages.length === 0) {
            if (this.pendingMessages.length === 0) {
                this.emit("empty")
            }
            return
        }

        this.emit("batch_received")

        const current = Date.now()
        const batch: PendingMessage[] = response.Messages.map((message) => ({
            sqsMessage: message,
            processing: false,
            arrivedAt: current,
            processingStartedAt: null,
        }))

        this.pendingMessages.push(...batch)

        this.emitPendingStatus()

        if (this.isBatchProcessing()) {
            this.processBatchPendingMessages()
        } else {
            this.processNextPendingMessage()
        }
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

            this.emit("message_processed", sqsMsg, {
                arrivedAt: message.arrivedAt,
                processingStartedAt: message.processingStartedAt,
                processedAt: processedTime,
                waitingTime: message.processingStartedAt - message.arrivedAt,
                processingTime: processedTime - message.processingStartedAt,
                totalTime: processedTime - message.arrivedAt,
            })

            await this.deleteMessage(sqsMsg)
        } catch (err) {
            this.emitError(err, sqsMsg)

            if (this.terminateVisibilityTimeout) {
                await this.changeVisibilityTimeout(sqsMsg, 0)
            }
        }
    }

    private processBatchPendingMessages(): void {
        const messages: PendingMessage[] = getNextPendingMessageBatch(this.pendingMessages)
        if (!messages.length) {
            return
        }
        const now = Date.now()
        for (const message of messages) {
            message.processing = true
            message.processingStartedAt = now
        }

        // TODO check what will async / await will do with the setImmediate
        this.processMessageBatch(messages).then(() => {
            setImmediate(this.processBatchPendingMessages)

            if (this.pollingStopped && isPollingReadyForNextReceive(this.batchSize, this.pendingMessages.length)) {
                setImmediate(this.pollSqs)
            }
        })

        setImmediate(this.processBatchPendingMessages)
    }

    private async processMessageBatch(messages: PendingMessages): Promise<void> {
        const sqsMessages = messages.map((m) => m.sqsMessage)

        this.emit("message_batch_received", sqsMessages)

        try {
            const processingStart = Date.now()

            await this.executeBatchHandler(sqsMessages)

            const processedTime = Date.now()

            this.emit("message_batch_processed", sqsMessages, {
                processingStartedAt: processingStart,
                processedAt: processedTime,
                // TODO log the batch
                // arrivedAt: message.arrivedAt,
                // waitingTime: message.processingStartedAt - message.arrivedAt,
                // processingTime: processedTime - message.processingStartedAt,
                // totalTime: processedTime - message.arrivedAt,
            })

            await this.deleteMessages(sqsMessages)
        } catch (err) {
            this.emitError(err, sqsMessages)

            if (this.terminateVisibilityTimeout) {
                await this.changeVisibilityTimeoutBatch(sqsMessages, 0)
            }
        }
    }

    private async receiveMessage(params: ReceiveMessageRequest): Promise<ReceiveMessageResult> {
        try {
            return await this.sqs.send(new ReceiveMessageCommand(params))
        } catch (err) {
            throw toSQSError(err, `SQS receive message failed: ${err.message}`)
        }
    }

    private async deleteMessage(message: Message) {
        const deleteParams = {
            QueueUrl: this.queueUrl,
            ReceiptHandle: message.ReceiptHandle as string,
        }

        try {
            await this.sqs.send(new DeleteMessageCommand(deleteParams))
        } catch (err) {
            throw toSQSError(err, `SQS delete message failed: ${err.message}`)
        } finally {
            // delete from pending messages
            this.pendingMessages = this.pendingMessages.filter((m) => m.sqsMessage.MessageId !== message.MessageId)
            this.emitPendingStatus()
        }
    }

    private async deleteMessages(messages: Message[]) {
        const deleteParams = {
            QueueUrl: this.queueUrl,
            Entries: messages.map((message) => ({
                Id: message.MessageId as string,
                ReceiptHandle: message.ReceiptHandle as string,
            })),
        }

        try {
            await this.sqs.send(new DeleteMessageBatchCommand(deleteParams))
        } catch (err) {
            throw toSQSError(err, `SQS delete message failed: ${err.message}`)
        } finally {
            // delete from pending messages
            this.pendingMessages = removeMessagesFromPending(this.pendingMessages, messages)
            this.emitPendingStatus()
        }
    }

    private async executeHandler(message: Message) {
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

            if (isFifo(this.queueUrl)) {
                const messages = getMessagesByGroupId(this.pendingMessages, message)
                // processing has failed, remove all following messages with the same groupId
                this.pendingMessages = filterOutByGroupId(this.pendingMessages, message)

                await this.changeVisibilityTimeoutOfBatch(messages, this.visibilityTimeout, 0)
            } else {
                this.pendingMessages = this.pendingMessages.filter((m) => m.sqsMessage.MessageId !== message.MessageId)
                await this.changeVisibilityTimeout(message, this.visibilityTimeout)
            }

            this.emitPendingStatus()

            throw err
        } finally {
            if (timeout && timeout.timeout) {
                clearTimeout(timeout.timeout)
            }
        }
    }

    private async executeBatchHandler(messages: Message[]) {
        let timeout: TimeoutResponse
        try {
            if (this.handleMessageTimeout) {
                timeout = createTimeout(this.handleMessageTimeout)
                await Promise.race([this.handleMessageBatch(messages), timeout.pending])
            } else {
                await this.handleMessageBatch(messages)
            }
        } catch (err) {
            if (err instanceof TimeoutError) {
                err.message = `Message handler timed out after ${this.handleMessageTimeout}ms: Operation timed out.`
            } else {
                err.message = `Unexpected message handler failure: ${err.message}`
            }
            const [message] = messages

            // find all messages with the same groupId
            const pendingMessages = getMessagesByGroupId(this.pendingMessages, message)
            // processing has failed, remove all following messages with the same groupId
            this.pendingMessages = filterOutByGroupId(this.pendingMessages, message)

            await this.changeVisibilityTimeoutOfBatch(pendingMessages, this.visibilityTimeout, 0)

            this.emitPendingStatus()

            throw err
        } finally {
            if (timeout && timeout.timeout) {
                clearTimeout(timeout.timeout)
            }
        }
    }

    private async changeVisibilityTimeout(message: Message, timeout: number) {
        try {
            return await this.sqs.send(
                new ChangeMessageVisibilityCommand({
                    QueueUrl: this.queueUrl,
                    ReceiptHandle: message.ReceiptHandle as string,
                    VisibilityTimeout: timeout,
                }),
            )
        } catch (err) {
            this.emit("error", toSQSError(err, `Error changing visibility timeout: ${err.message}`), message)
        }
    }

    private emitPendingStatus() {
        this.emit("pending_status", {
            messagesProcessing: this.pendingMessages.filter((m) => m.processing === true).length,
            messagesWaiting: this.pendingMessages.filter((m) => m.processing === false).length,
        })
    }

    private emitError(err: Error, message: Message): void
    private emitError(err: Error, messages: Message[]): void
    private emitError(err: Error, messageOrMessages: Message | Message[]): void {
        if (err.name === SQSError.name) {
            this.emit("error", err, messageOrMessages)
            return
        }
        if (err instanceof TimeoutError) {
            this.emit("timeout_error", err, messageOrMessages)
            return
        }
        if (Array.isArray(messageOrMessages)) {
            this.emit("batch_processing_error", err, messageOrMessages)
            return
        }
        this.emit("processing_error", err, messageOrMessages)
    }

    private async changeVisibilityTimeoutOfBatch(batch: PendingMessages, timeout: number, elapsedSeconds: number) {
        const visibilityResponse = await this.changeVisibilityTimeoutBatch(
            batch.map((a) => a.sqsMessage),
            timeout,
        )
        this.emit("visibility_timeout_changed", batch, visibilityResponse, elapsedSeconds, timeout)
    }

    private async changeVisibilityTimeoutBatch(messages: Message[], timeout: number) {
        if (!messages.length) {
            return
        }
        const params = {
            QueueUrl: this.queueUrl,
            Entries: messages.map((message) => ({
                Id: message.MessageId as string,
                ReceiptHandle: message.ReceiptHandle as string,
                VisibilityTimeout: timeout,
            })),
        }
        try {
            return await this.sqs.send(new ChangeMessageVisibilityBatchCommand(params))
        } catch (err) {
            this.emit("error", toSQSError(err, `Error changing visibility timeout batch: ${err.message}`), messages)
        }
    }

    private startHeartbeat(): void {
        this.heartbeatTimeout = setInterval(async () => {
            const now = Date.now()
            const batches = groupMessageBatchByArrivedTime(this.pendingMessages)
            for (const batch of batches) {
                const elapsedSeconds = Math.ceil((now - batch[0].arrivedAt) / 1000)
                const timeout = this.visibilityTimeout || 0
                await this.changeVisibilityTimeoutOfBatch(batch, timeout, elapsedSeconds)
            }
        }, this.heartbeatInterval * 1000)
    }

    private stopHeartbeat(): void {
        clearInterval(this.heartbeatTimeout)
    }

    private isBatchProcessing(): boolean {
        return typeof this.handleMessageBatch === "function"
    }
}
