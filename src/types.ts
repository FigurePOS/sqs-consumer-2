import { Message, SQSClient } from "@aws-sdk/client-sqs"

export interface TimeoutResponse {
    timeout: NodeJS.Timeout | null
    pending: Promise<void>
}

export interface BatchProcessingResult {
    successful: Message[]
    failed: Message[]
}

export type PollLivenessWatchdogOptions = {
    /**
     * Maximum seconds since the last completed long-poll before the watchdog fires.
     * @default 60
     */
    maxStaleSeconds?: number
    /**
     * How often the watchdog checks poll liveness.
     * @default 10000
     */
    checkIntervalMs?: number
    onStale: () => void
}

export type ConsumerOptions = {
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
    /**
     * Maximum time a single ReceiveMessage long-poll may run before poll liveness is unhealthy.
     * @default max(35000, waitTimeSeconds * 1000 + 5000)
     */
    pollReceiveTimeoutMs?: number
    pollLivenessWatchdog?: PollLivenessWatchdogOptions
    sqs?: SQSClient
    region?: string
    handleMessageTimeout?: number

    handleMessage?: (message: Message) => Promise<void>
    handleMessageBatch?: (messages: Message[]) => Promise<BatchProcessingResult>
    /**
     * Function to group messages in batch. If `null` the batch is returned as is.
     */
    batchProcessingGroupFunction?: ((batch: PendingMessage[]) => PendingMessage[][]) | null

    /**
     * Function to transform messages before processing.
     */
    transformMessages?: (messages: Message[]) => Message[]
}

export interface Events {
    empty: []
    message_received: [Message]
    message_processed: [Message, any]
    error: [Error, void | Message | Message[]]
    timeout_error: [Error, Message | Message[]]
    processing_error: [Error, Message]
    stopped: []
    pending_status: [PendingStatus]
    batch_received: []
    visibility_timeout_changed: [PendingMessages, any, number, number]
    message_batch_received: [Message[]]
    message_batch_processed: [Message[], any]
    batch_processing_error: [Error, Message[]]
    poll_liveness_stale: []
}

export type PendingStatus = {
    messagesProcessing: number
    messagesWaiting: number
}

export type PendingMessage = {
    sqsMessage: Message
    processing: boolean
    arrivedAt: number
    processingStartedAt: number | null
}

export type PendingMessages = PendingMessage[]
