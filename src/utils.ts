import { PendingMessage, PendingMessages, TimeoutResponse } from "./types"
import { SQSError, TimeoutError } from "./errors"
import { AWSError } from "aws-sdk"

export const getNextPendingMessage = (batch: PendingMessages): PendingMessage | null => {
    return batch
        .filter(
            (msg) =>
                !batch
                    .filter((e) => e.processing && e.sqsMessage.Attributes?.MessageGroupId != null)
                    .map((e) => e.sqsMessage.Attributes?.MessageGroupId)
                    .includes(msg.sqsMessage.Attributes?.MessageGroupId),
        )
        .find((b) => !b.processing)
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

export const toSQSError = (err: AWSError, message: string): SQSError => {
    const sqsError = new SQSError(message)
    sqsError.code = err.code
    sqsError.statusCode = err.statusCode
    sqsError.region = err.region
    sqsError.retryable = err.retryable
    sqsError.hostname = err.hostname
    sqsError.time = err.time

    return sqsError
}
