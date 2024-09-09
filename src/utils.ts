import { Message } from "@aws-sdk/client-sqs"
import { SQSError, TimeoutError } from "./errors"
import { PendingMessage, PendingMessages, TimeoutResponse } from "./types"

export const getNextPendingMessage = (batch: PendingMessages): PendingMessage | null => {
    const uniqGroupIds = batch
        .filter((e) => e.processing && e.sqsMessage.Attributes?.MessageGroupId != null)
        .map((e) => e.sqsMessage.Attributes?.MessageGroupId)

    return batch
        .filter((msg) => !uniqGroupIds.includes(msg.sqsMessage.Attributes?.MessageGroupId))
        .find((b) => !b.processing)
}

/**
 * Gets the first message batch from pending messages grouped by MessageGroupId
 * @param batch
 * @todo think of using generic function to group by any key
 */
export const getNextPendingMessageBatch = (batch: PendingMessages): PendingMessages => {
    const [batchToProcess] = groupMessageBatchByGroupId(batch.filter((m) => !m.processing))
    return batchToProcess || []
}

export const filterOutByGroupId = (pendingMessages: PendingMessages, msg: Message): PendingMessages => {
    return pendingMessages.filter(
        (m) =>
            m.sqsMessage.MessageId !== msg.MessageId &&
            (m.sqsMessage.Attributes?.MessageGroupId == null ||
                m.sqsMessage.Attributes?.MessageGroupId != msg.Attributes?.MessageGroupId),
    )
}

export const getMessagesByGroupId = (pendingMessages: PendingMessages, msg: Message): PendingMessages => {
    return pendingMessages.filter(
        (m) =>
            m.sqsMessage.Attributes?.MessageGroupId != null &&
            m.sqsMessage.Attributes?.MessageGroupId === msg.Attributes?.MessageGroupId,
    )
}

export const groupMessageBatchByArrivedTime = (batch: PendingMessages): PendingMessages[] => {
    return [...new Set(batch.map((w) => w.arrivedAt))].map((arrived) => batch.filter((w) => w.arrivedAt === arrived))
}

export const groupMessageBatchByGroupId = (batch: PendingMessage[]): PendingMessage[][] => {
    return [...new Set(batch.map((w) => w.sqsMessage.Attributes?.MessageGroupId))].map((groupId) => {
        return batch.filter((w) => w.sqsMessage.Attributes?.MessageGroupId === groupId)
    })
}

export const isPollingReadyForNextReceive = (batchSize: number, pendingSize: number): boolean => {
    return pendingSize + Math.min(10, batchSize) <= batchSize
}

export const createTimeout = (duration: number): TimeoutResponse => {
    let timeout = null
    const pending: Promise<void> = new Promise((_, reject) => {
        timeout = setTimeout((): void => {
            reject(new TimeoutError())
        }, duration)
    })
    return { timeout: timeout, pending: pending }
}

export const isConnectionError = (err: Error): boolean => {
    if (err instanceof SQSError) {
        return err.statusCode === 403 || err.code === "CredentialsError" || err.code === "UnknownEndpoint"
    }
    return false
}

export const toSQSError = (err, message: string): SQSError => {
    const sqsError = new SQSError(message)
    sqsError.code = err.code
    sqsError.statusCode = err.statusCode
    sqsError.region = err.region
    sqsError.retryable = err.retryable
    sqsError.hostname = err.hostname
    sqsError.time = err.time

    return sqsError
}

export const isFifo = (queueUrl: string): boolean => {
    if (!queueUrl) {
        return false
    }
    const { length } = queueUrl
    return queueUrl.substring(length - 5, length) === ".fifo"
}

export const removeMessagesFromPending = (pendingMessages: PendingMessages, messages: Message[]): PendingMessages => {
    return pendingMessages.filter((m) => !messages.find((msg) => msg.MessageId === m.sqsMessage.MessageId))
}
