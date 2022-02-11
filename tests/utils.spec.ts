import { assert, expect } from "chai"
import { getNextPendingMessage, groupMessageBatchByArrivedTime, isPollingReadyForNextReceive } from "../src/utils"
import { PendingMessage } from "../src/consumer"

describe("getNextPendingMessage", () => {
    it("return null given empty message batch", () => {
        const batch = []
        const result = null

        assert.equal(getNextPendingMessage(batch), result)
    })

    it("return first non processing message given message batch", () => {
        const result = createMessage("2", "2", false)
        const batch = [createMessage("1", "1", true), result]

        assert.equal(getNextPendingMessage(batch), result)
    })

    it("return first non processing with groupId different from already processing", () => {
        const result = createMessage("3", "2", false)
        const batch = [createMessage("1", "1", true), createMessage("2", "1", false), result]

        assert.equal(getNextPendingMessage(batch), result)
    })

    it("return null because the only processable message (id 2) is blocked by id 1", () => {
        const batch = [createMessage("1", "1", true), createMessage("2", "1", false), createMessage("3", "2", true)]
        const result = null

        assert.equal(getNextPendingMessage(batch), result)
    })

    it("return first not processing message if groupIds not defined", () => {
        const result = createMessage("2", null, false)
        const batch = [createMessage("1", null, true), result, createMessage("3", null, false)]

        assert.equal(getNextPendingMessage(batch), result)
    })
})

describe("groupMessageBatchByArrivedTime", () => {
    it("return empty list given empty list", () => {
        const batch = []

        expect(groupMessageBatchByArrivedTime(batch)).to.be.empty
    })

    it("return grouped messages by the same arrived timex", () => {
        const batch = [
            createMessage("1", "1", true, 1),
            createMessage("2", "1", false, 1),
            createMessage("3", "1", true, 2),
            createMessage("4", "1", false, 3),
            createMessage("5", "1", false, 1),
            createMessage("6", "1", false, 3),
            createMessage("7", "1", false, 2),
        ]
        const result = [
            [createMessage("1", "1", true, 1), createMessage("2", "1", false, 1), createMessage("5", "1", false, 1)],
            [createMessage("3", "1", true, 2), createMessage("7", "1", false, 2)],
            [createMessage("4", "1", false, 3), createMessage("6", "1", false, 3)],
        ]

        expect(groupMessageBatchByArrivedTime(batch)).to.deep.equal(result)
    })
})

describe("isPollingReadyForNextReceive", () => {
    it("returns false if the batch is completely full", () => {
        expect(isPollingReadyForNextReceive(100, 100)).to.be.false
    })
    it("returns true if the batch is completely empty", () => {
        expect(isPollingReadyForNextReceive(100, 0)).to.be.true
    })
    it("returns true if there is still space for next 10 messages", () => {
        expect(isPollingReadyForNextReceive(100, 90)).to.be.true
    })
    it("returns false if there is no space for next 10 messages", () => {
        expect(isPollingReadyForNextReceive(100, 91)).to.be.false
    })
})

const createMessage = (
    id: string,
    groupId: string | null,
    processing: boolean,
    arrived: number = 0,
): PendingMessage => ({
    sqsMessage: {
        MessageId: id,
        ...(groupId
            ? {
                  Attributes: {
                      MessageGroupId: groupId,
                  },
              }
            : null),
    },
    processing: processing,
    arrivedAt: arrived,
})
