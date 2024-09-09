import { assert, expect } from "chai"
import { PendingMessage } from "../src/types"
import {
    filterOutByGroupId,
    getNextPendingMessage,
    getNextPendingMessageBatch,
    groupMessageBatchByArrivedTime,
    groupMessageBatchByGroupId,
    isFifo,
    isPollingReadyForNextReceive,
    removeMessagesFromPending,
} from "../src/utils"

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

    it("return null if any message with groupId is processing", () => {
        // const result = createMessage("2", null, false)
        const batch = [createMessage("1", "group1", true), createMessage("1", "group1", false)]

        assert.equal(getNextPendingMessage(batch), null)
    })
})

describe("getNextPendingMessageBatch", () => {
    it("should return empty list given empty list", () => {
        const batch = []

        expect(getNextPendingMessageBatch(batch)).to.be.empty
    })

    it("should return the first group of messages that are not processing", () => {
        const batch = [
            createMessage("1", "1", true),
            createMessage("2", "1", false),
            createMessage("3", "1", true),
            createMessage("4", "2", false),
            createMessage("5", "2", false),
            createMessage("6", "4", false),
            createMessage("7", "1", false),
        ]
        const result = [createMessage("2", "1", false), createMessage("7", "1", false)]

        expect(getNextPendingMessageBatch(batch)).to.deep.equal(result)
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

describe("groupMessageBatchByGroupId", () => {
    it("return empty list given empty list", () => {
        const batch = []

        expect(groupMessageBatchByGroupId(batch)).to.be.empty
    })

    it("return grouped messages by the same groupId", () => {
        const batch = [
            createMessage("1", "1", true),
            createMessage("2", "1", false),
            createMessage("3", "1", true),
            createMessage("4", "2", false),
            createMessage("5", "2", false),
            createMessage("6", "4", false),
            createMessage("7", "1", false),
        ]
        const result = [
            [
                createMessage("1", "1", true),
                createMessage("2", "1", false),
                createMessage("3", "1", true),
                createMessage("7", "1", false),
            ],
            [createMessage("4", "2", false), createMessage("5", "2", false)],
            [createMessage("6", "4", false)],
        ]

        expect(groupMessageBatchByGroupId(batch)).to.deep.equal(result)
    })

    it("return grouped messages by the same groupId and messages without groupId", () => {
        const batch = [
            createMessage("1", "1", true),
            createMessage("2", "1", false),
            createMessage("3", "1", true),
            createMessage("4", "2", false),
            createMessage("5", "2", false),
            createMessage("6", "4", false),
            createMessage("7", null, false),
            createMessage("8", null, false),
        ]
        const result = [
            [createMessage("1", "1", true), createMessage("2", "1", false), createMessage("3", "1", true)],
            [createMessage("4", "2", false), createMessage("5", "2", false)],
            [createMessage("6", "4", false)],
            [createMessage("7", null, false), createMessage("8", null, false)],
        ]

        expect(groupMessageBatchByGroupId(batch)).to.deep.equal(result)
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
    it("returns false if there is no space for next 3 messages", () => {
        expect(isPollingReadyForNextReceive(3, 1)).to.be.false
    })
})

describe("filterOutByGroupId", () => {
    it("filters all messages with the same groupId", () => {
        const batch = [
            createMessage("1", "1", true, 1),
            createMessage("2", "2", false, 2),
            createMessage("3", "3", true, 3),
            createMessage("4", "1", false, 4),
            createMessage("5", "1", false, 5),
            createMessage("6", "4", false, 6),
            createMessage("7", "1", false, 7),
        ]
        const result = [
            createMessage("2", "2", false, 2),
            createMessage("3", "3", true, 3),
            createMessage("6", "4", false, 6),
        ]

        expect(filterOutByGroupId(batch, { Attributes: { MessageGroupId: "1" }, MessageId: "1" })).to.deep.equal(result)
    })

    it("filters no messages if the same groupId not present", () => {
        const batch = [
            createMessage("1", "1", true, 1),
            createMessage("2", "2", false, 2),
            createMessage("3", "3", true, 3),
        ]
        const result = [
            createMessage("1", "1", true, 1),
            createMessage("2", "2", false, 2),
            createMessage("3", "3", true, 3),
        ]

        expect(filterOutByGroupId(batch, { Attributes: { MessageGroupId: "100" }, MessageId: "100" })).to.deep.equal(
            result,
        )
    })

    it("doesnt remove anything if messages don't have group id at all (no fifo)", () => {
        const batch = [
            createMessage("1", null, true, 1),
            createMessage("2", null, false, 2),
            createMessage("3", null, true, 3),
        ]
        const result = [
            createMessage("1", null, true, 1),
            createMessage("2", null, false, 2),
            createMessage("3", null, true, 3),
        ]

        expect(filterOutByGroupId(batch, { Attributes: { MessageGroupId: "1" }, MessageId: "31" })).to.deep.equal(
            result,
        )
    })

    it("removes all messgaes with the same message id (just to be sure)", () => {
        const batch = [
            createMessage("1", null, true, 1),
            createMessage("2", null, false, 2),
            createMessage("3", null, true, 3),
            createMessage("2", null, true, 1),
            createMessage("2", null, false, 2),
            createMessage("2", null, true, 3),
        ]
        const result = [createMessage("1", null, true, 1), createMessage("3", null, true, 3)]

        expect(filterOutByGroupId(batch, { Attributes: { MessageGroupId: "2" }, MessageId: "2" })).to.deep.equal(result)
    })

    it("filters all messages if all pending messages has the target groupId", () => {
        const batch = [createMessage("1", "1", true, 1), createMessage("2", "1", true, 2)]

        expect(filterOutByGroupId(batch, { Attributes: { MessageGroupId: "1" }, MessageId: "3" })).to.be.empty
    })

    it("produces empty array pending message is empty", () => {
        const batch = []

        expect(filterOutByGroupId(batch, { Attributes: { MessageGroupId: "1" }, MessageId: "32" })).to.be.empty
    })
})

describe("isFifo", () => {
    it("returns true if the queue url ends with .fifo", () => {
        expect(isFifo("https://sqs.eu-west-1.amazonaws.com/123456789012/MyQueue.fifo")).to.be.true
    })

    it("returns false if the queue url does not end with .fifo", () => {
        expect(isFifo("https://sqs.eu-west-1.amazonaws.com/123456789012/MyQueue")).to.be.false
    })

    it("returns false if the queue url is empty", () => {
        expect(isFifo("")).to.be.false
    })

    it("returns false if the queue url is null", () => {
        // @ts-ignore
        expect(isFifo(null)).to.be.false
    })
})

describe("removeMessagesFromPending", () => {
    it("should remove all messages from the batch", () => {
        const batch = [
            createMessage("1", "1", true, 1),
            createMessage("2", "2", false, 2),
            createMessage("3", "3", true, 3),
        ]
        const messages = [
            { Attributes: { MessageGroupId: "1" }, MessageId: "1" },
            { Attributes: { MessageGroupId: "1" }, MessageId: "2" },
            { Attributes: { MessageGroupId: "1" }, MessageId: "3" },
        ]

        expect(removeMessagesFromPending(batch, messages)).to.be.empty
    })

    it("should remove only defined messages from the batch", () => {
        const batch = [
            createMessage("1", "1", true, 1),
            createMessage("2", "2", false, 2),
            createMessage("3", "3", true, 3),
        ]
        const messages = [
            { Attributes: { MessageGroupId: "1" }, MessageId: "1" },
            { Attributes: { MessageGroupId: "1" }, MessageId: "3" },
        ]
        const result = [createMessage("2", "2", false, 2)]

        expect(removeMessagesFromPending(batch, messages)).to.deep.equal(result)
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
    processingStartedAt: 0,
})
