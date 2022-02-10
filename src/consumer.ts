import { AWSError } from "aws-sdk"
import * as SQS from "aws-sdk/clients/sqs"
import { PromiseResult } from "aws-sdk/lib/request"
import { EventEmitter } from "events"
import { autoBind } from "./bind"
import { SQSError, TimeoutError } from "./errors"

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

function assertOptions(options: ConsumerOptions): void {
    if (options.batchSize != null && (options.batchSize > 10 || options.batchSize < 1)) {
        throw new Error("SQS batchSize option must be between 1 and 10.")
    }
    if (
        options.heartbeatInterval != null &&
        options.visibilityTimeout != null &&
        !(options.heartbeatInterval < options.visibilityTimeout)
    ) {
        throw new Error("heartbeatInterval must be less than visibilityTimeout.")
    }
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
    handleMessage?(message: SQSMessage): Promise<void>
    handleMessageBatch?(messages: SQSMessage[]): Promise<void>
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

export class Consumer extends EventEmitter {
    private readonly queueUrl: string
    private readonly handleMessage?: (message: SQSMessage) => Promise<void>
    private readonly handleMessageBatch?: (message: SQSMessage[]) => Promise<void>
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

    private stopped: boolean

    constructor(options: ConsumerOptions) {
        super()
        assertOptions(options)
        this.queueUrl = options.queueUrl
        this.handleMessage = options.handleMessage
        this.handleMessageBatch = options.handleMessageBatch
        this.handleMessageTimeout = options.handleMessageTimeout
        this.attributeNames = options.attributeNames || []
        this.messageAttributeNames = options.messageAttributeNames || ["All"]
        this.stopped = true
        this.batchSize = options.batchSize || 10
        this.visibilityTimeout = options.visibilityTimeout
        this.terminateVisibilityTimeout = options.terminateVisibilityTimeout || false
        this.heartbeatInterval = options.heartbeatInterval || 5
        this.waitTimeSeconds = options.waitTimeSeconds || 20
        this.authenticationErrorTimeout = options.authenticationErrorTimeout || 10000
        this.pollingWaitTimeMs = options.pollingWaitTimeMs || 10

        this.sqs =
            options.sqs ||
            new SQS({
                region: options.region || process.env.AWS_REGION || "eu-west-1",
            })

        autoBind(this)
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
            this.poll()
        }
    }

    public stop(): void {
        this.stopped = true
    }

    private async handleSqsResponse(response: ReceiveMessageResponse): Promise<void> {
        if (response) {
            if (response.Messages && response.Messages.length > 0) {
                // const processedMessages = processIncomingSqsMessages(response.Messages)
                const processedMessages = response.Messages

                if (this.handleMessageBatch) {
                    // prefer handling messages in batch when available
                    await this.processMessageBatch(processedMessages)
                } else {
                    // handle messages in sequence to preserve ordering
                    for (const message of processedMessages) {
                        await this.processMessage(message)
                    }
                }
                this.emit("response_processed")
            } else {
                this.emit("empty")
            }
        }
    }

    private async processMessage(message: SQSMessage): Promise<void> {
        this.emit("message_received", message)

        let heartbeat
        try {
            if (this.heartbeatInterval) {
                heartbeat = this.startHeartbeat(async (elapsedSeconds) => {
                    return this.changeVisibilityTimeout(message, elapsedSeconds + (this.visibilityTimeout || 0))
                })
            }
            await this.executeHandler(message)
            await this.deleteMessage(message)
            this.emit("message_processed", message)
        } catch (err) {
            this.emit("processing_error", err, message)

            if (this.terminateVisibilityTimeout) {
                await this.changeVisibilityTimeout(message, 0)
            }
        } finally {
            if (heartbeat) {
                clearInterval(heartbeat)
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
            await this.sqs.deleteMessage(deleteParams).promise()
        } catch (err) {
            throw toSQSError(err, `SQS delete message failed: ${err.message}`)
        }
    }

    private async executeHandler(message: SQSMessage): Promise<void> {
        let timeout
        try {
            if (!this.handleMessage) {
                return
            }
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

    private poll(): void {
        if (this.stopped) {
            this.emit("stopped")
            return
        }

        const receiveParams = {
            QueueUrl: this.queueUrl,
            AttributeNames: this.attributeNames,
            MessageAttributeNames: this.messageAttributeNames,
            MaxNumberOfMessages: this.batchSize,
            WaitTimeSeconds: this.waitTimeSeconds,
            ...(this.visibilityTimeout ? { VisibilityTimeout: this.visibilityTimeout } : null),
        }

        let currentPollingTimeout = this.pollingWaitTimeMs
        this.receiveMessage(receiveParams)
            .then(this.handleSqsResponse)
            .catch((err) => {
                this.emit("error", err)
                if (isConnectionError(err)) {
                    currentPollingTimeout = this.authenticationErrorTimeout
                }
                return
            })
            .then(() => {
                setTimeout(this.poll, currentPollingTimeout)
            })
            .catch((err) => {
                this.emit("error", err)
            })
    }

    private async processMessageBatch(messages: SQSMessage[]): Promise<void> {
        messages.forEach((message) => {
            this.emit("message_received", message)
        })

        let heartbeat
        try {
            if (this.heartbeatInterval) {
                heartbeat = this.startHeartbeat(async (elapsedSeconds) => {
                    return this.changeVisibilityTimeoutBatch(messages, elapsedSeconds + (this.visibilityTimeout || 0))
                })
            }
            await this.executeBatchHandler(messages)
            await this.deleteMessageBatch(messages)
            messages.forEach((message) => {
                this.emit("message_processed", message)
            })
        } catch (err) {
            this.emit("error", err, messages)

            if (this.terminateVisibilityTimeout) {
                await this.changeVisibilityTimeoutBatch(messages, 0)
            }
        } finally {
            if (heartbeat) {
                clearInterval(heartbeat)
            }
        }
    }

    private async deleteMessageBatch(messages: SQSMessage[]): Promise<void> {
        const deleteParams = {
            QueueUrl: this.queueUrl,
            Entries: messages.map((message) => ({
                Id: message.MessageId || "",
                ReceiptHandle: message.ReceiptHandle || "",
            })),
        }

        try {
            await this.sqs.deleteMessageBatch(deleteParams).promise()
        } catch (err) {
            throw toSQSError(err, `SQS delete message failed: ${err.message}`)
        }
    }

    private async executeBatchHandler(messages: SQSMessage[]): Promise<void> {
        try {
            if (!this.handleMessageBatch) {
                return
            }
            await this.handleMessageBatch(messages)
        } catch (err) {
            err.message = `Unexpected message handler failure: ${err.message}`
            throw err
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

    private startHeartbeat(heartbeatFn: (elapsedSeconds: number) => void): NodeJS.Timeout {
        const startTime = Date.now()
        return setInterval(() => {
            const elapsedSeconds = Math.ceil((Date.now() - startTime) / 1000)
            heartbeatFn(elapsedSeconds)
        }, this.heartbeatInterval * 1000)
    }
}
