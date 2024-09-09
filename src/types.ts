import { Message, SQSClient } from "@aws-sdk/client-sqs"

export interface TimeoutResponse {
    timeout: NodeJS.Timeout | null
    pending: Promise<void>
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
    sqs?: SQSClient
    region?: string
    handleMessageTimeout?: number

    handleMessage?: (message: Message) => Promise<void>
    handleMessageBatch?: (messages: Message[]) => Promise<void>
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
