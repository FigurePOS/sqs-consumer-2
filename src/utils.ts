import { PendingMessage, PendingMessages, TimeoutResponse } from "./types"
import { SQSError, TimeoutError } from "./errors"
import { Message } from "@aws-sdk/client-sqs"

export const getNextPendingMessage = (batch: PendingMessages): PendingMessage | null => {
    const uniqGroupIds = batch
        .filter((e) => e.processing && e.sqsMessage.Attributes?.MessageGroupId != null)
        .map((e) => e.sqsMessage.Attributes?.MessageGroupId)

    return batch
        .filter((msg) => !uniqGroupIds.includes(msg.sqsMessage.Attributes?.MessageGroupId))
        .find((b) => !b.processing)
}

export const filterOutByGroupId = (pendingMessages: PendingMessages, msg: Message): PendingMessages => {
    return pendingMessages.filter(
        (m) =>
            m.sqsMessage.MessageId !== msg.MessageId &&
            (m.sqsMessage.Attributes?.MessageGroupId == null ||
                m.sqsMessage.Attributes?.MessageGroupId != msg.Attributes?.MessageGroupId),
    )
}

export const groupMessageBatchByArrivedTime = (batch: PendingMessages): PendingMessages[] => {
    return [...new Set(batch.map((w) => w.arrivedAt))].map((arrived) => batch.filter((w) => w.arrivedAt === arrived))
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
