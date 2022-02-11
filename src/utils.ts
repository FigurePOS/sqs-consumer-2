import { PendingMessage, PendingMessages } from "./consumer"

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
    return pendingSize + 10 <= batchSize
}
