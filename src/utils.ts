import { PendingMessage, PendingMessages } from "./consumer"

export const getNextPendingMessage = (batch: PendingMessages): PendingMessage | null => {
    return batch
        .filter(
            (b) =>
                !batch
                    .filter((e) => e.processing && e.sqsMessage.Attributes?.MessageGroupId != null)
                    .map((e) => e.sqsMessage.Attributes?.MessageGroupId)
                    .includes(b.sqsMessage.Attributes?.MessageGroupId),
        )
        .find((b) => !b.processing)
}

export const groupMessageBatchByArrivedTime = (batch: PendingMessages): PendingMessages[] => {
    return [...new Set(batch.map((w) => w.arrivedAt))].map((arrived) => batch.filter((w) => w.arrivedAt === arrived))
}
