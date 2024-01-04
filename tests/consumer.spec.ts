import { assert } from "chai"
import * as pEvent from "p-event"
import * as sinon from "sinon"
import { Consumer } from "../src/consumer"
import { Command } from "@smithy/smithy-client"
import {
    ReceiveMessageCommand,
    DeleteMessageCommand,
    DeleteMessageBatchCommand,
    ChangeMessageVisibilityCommand,
    ChangeMessageVisibilityBatchCommand,
} from "@aws-sdk/client-sqs"

const sandbox = sinon.createSandbox()

const AUTHENTICATION_ERROR_TIMEOUT = 20
const POLLING_TIMEOUT = 100

function overrideResolveStub<T extends new (...args: any[]) => Command<any, any, any>, U>(C: T, value?: U): any {
    const stub = createBaseStub()
    stub.withArgs(sinon.match.instanceOf(C)).resolves(value)
    return stub
}

function overrideRejectStub<T extends new (...args: any[]) => Command<any, any, any>, U>(C: T, value?: U): any {
    const stub = createBaseStub()
    stub.withArgs(sinon.match.instanceOf(C)).rejects(value)
    return stub
}

function createBaseStub() {
    const stub = sandbox.stub()
    stub.withArgs(sinon.match.instanceOf(ReceiveMessageCommand)).resolves({
        Messages: [
            {
                ReceiptHandle: "receipt-handle",
                MessageId: "123",
                Body: "body",
            },
        ],
    })
    stub.withArgs(sinon.match.instanceOf(DeleteMessageCommand)).resolves()
    stub.withArgs(sinon.match.instanceOf(DeleteMessageBatchCommand)).resolves()
    stub.withArgs(sinon.match.instanceOf(ChangeMessageVisibilityCommand)).resolves()
    stub.withArgs(sinon.match.instanceOf(ChangeMessageVisibilityBatchCommand)).resolves()
    return stub
}

class MockSQSError extends Error {
    code: string
    statusCode: number
    region: string
    hostname: string
    time: Date
    retryable: boolean

    constructor(message: string) {
        super(message)
        this.message = message
    }
}

// tslint:disable:no-unused-expression
describe("Consumer", () => {
    let consumer
    let clock
    let handleMessage
    let sqs
    const response = {
        Messages: [
            {
                ReceiptHandle: "receipt-handle",
                MessageId: "123",
                Body: "body",
            },
        ],
    }

    beforeEach(() => {
        clock = sinon.useFakeTimers()
        handleMessage = sandbox.stub().resolves(null)
        sqs = sandbox.mock()
        sqs.send = createBaseStub()

        consumer = new Consumer({
            queueUrl: "some-queue-url.fifo",
            region: "some-region",
            handleMessage,
            sqs,
            authenticationErrorTimeout: 20,
        })
    })

    afterEach(() => {
        sandbox.restore()
    })

    it("requires the batchSize option to be greater than 0", () => {
        assert.throws(() => {
            new Consumer({
                region: "some-region",
                queueUrl: "some-queue-url.fifo",
                handleMessage,
                batchSize: -1,
            })
        })
    })

    it("requires visibilityTimeout to be set with heartbeatInterval", () => {
        assert.throws(() => {
            new Consumer({
                region: "some-region",
                queueUrl: "some-queue-url.fifo",
                handleMessage,
                heartbeatInterval: 30,
            })
        })
    })

    it("requires heartbeatInterval to be less than visibilityTimeout", () => {
        assert.throws(() => {
            new Consumer({
                region: "some-region",
                queueUrl: "some-queue-url.fifo",
                handleMessage,
                heartbeatInterval: 30,
                visibilityTimeout: 30,
            })
        })
    })

    describe(".create", () => {
        it("creates a new instance of a Consumer object", () => {
            const instance = Consumer.create({
                region: "some-region",
                queueUrl: "some-queue-url.fifo",
                batchSize: 1,
                visibilityTimeout: 10,
                waitTimeSeconds: 10,
                handleMessage,
            })

            assert.instanceOf(instance, Consumer)
        })
    })

    describe(".start", () => {
        it("fires an error event when an error occurs receiving a message", async () => {
            const receiveErr = new Error("Receive error")

            sqs.send = overrideRejectStub(ReceiveMessageCommand, receiveErr)

            consumer.start()

            const err: any = await pEvent(consumer, "error")

            consumer.stop()
            assert.ok(err)
            assert.equal(err.message, "SQS receive message failed: Receive error")
        })

        it("retains sqs error information", async () => {
            const receiveErr = new MockSQSError("Receive error")
            receiveErr.code = "short code"
            receiveErr.retryable = false
            receiveErr.statusCode = 403
            receiveErr.time = new Date()
            receiveErr.hostname = "hostname"
            receiveErr.region = "eu-west-1"

            sqs.send = overrideRejectStub(ReceiveMessageCommand, receiveErr)

            consumer.start()
            const err: any = await pEvent(consumer, "error")
            consumer.stop()

            assert.ok(err)
            assert.equal(err.message, "SQS receive message failed: Receive error")
            assert.equal(err.code, receiveErr.code)
            assert.equal(err.retryable, receiveErr.retryable)
            assert.equal(err.statusCode, receiveErr.statusCode)
            assert.equal(err.time, receiveErr.time)
            assert.equal(err.hostname, receiveErr.hostname)
            assert.equal(err.region, receiveErr.region)
        })

        it("fires a timeout event if handler function takes too long", async () => {
            const handleMessageTimeout = 500
            consumer = new Consumer({
                queueUrl: "some-queue-url.fifo",
                region: "some-region",
                handleMessage: () => new Promise((resolve) => setTimeout(resolve, 1000)),
                handleMessageTimeout,
                sqs,
                authenticationErrorTimeout: 20,
            })

            consumer.start()
            const [err]: any = await Promise.all([
                pEvent(consumer, "timeout_error"),
                clock.tickAsync(handleMessageTimeout),
            ])
            consumer.stop()

            assert.ok(err)
            assert.equal(err.message, `Message handler timed out after ${handleMessageTimeout}ms: Operation timed out.`)
        })

        it("handles unexpected exceptions thrown by the handler function", async () => {
            consumer = new Consumer({
                queueUrl: "some-queue-url.fifo",
                region: "some-region",
                handleMessage: () => {
                    throw new Error("unexpected parsing error")
                },
                sqs,
                authenticationErrorTimeout: 20,
            })

            consumer.start()
            const err: any = await pEvent(consumer, "processing_error")
            consumer.stop()

            assert.ok(err)
            assert.equal(err.message, "Unexpected message handler failure: unexpected parsing error")
        })

        it("fires an error event when an error occurs deleting a message", async () => {
            const deleteErr = new Error("Delete error")

            handleMessage.resolves(null)
            sqs.send = overrideRejectStub(DeleteMessageCommand, deleteErr)

            consumer.start()
            const err: any = await pEvent(consumer, "error")
            consumer.stop()

            assert.ok(err)
            assert.equal(err.message, "SQS delete message failed: Delete error")
        })

        it("fires a `processing_error` event when a non-`SQSError` error occurs processing a message", async () => {
            const processingErr = new Error("Processing error")

            handleMessage.rejects(processingErr)

            consumer.start()
            const [err, message] = await pEvent(consumer, "processing_error", { multiArgs: true })
            consumer.stop()

            assert.equal(err.message, "Unexpected message handler failure: Processing error")
            assert.equal(message.MessageId, "123")
        })

        it("fires an `error` event when an `SQSError` occurs processing a message", async () => {
            const sqsError = new Error("Processing error")
            sqsError.name = "SQSError"

            handleMessage.resolves(sqsError)
            sqs.send = overrideRejectStub(DeleteMessageCommand, sqsError)

            consumer.start()
            const [err, message] = await pEvent(consumer, "error", { multiArgs: true })
            consumer.stop()

            assert.equal(err.message, "SQS delete message failed: Processing error")
            assert.equal(message.MessageId, "123")
        })

        it("waits before repolling when a credentials error occurs", async () => {
            const credentialsErr = {
                code: "CredentialsError",
                message: "Missing credentials in config",
            }
            sqs.send = overrideRejectStub(ReceiveMessageCommand, credentialsErr)
            const errorListener = sandbox.stub()
            consumer.on("error", errorListener)

            consumer.start()
            await clock.tickAsync(AUTHENTICATION_ERROR_TIMEOUT)
            consumer.stop()

            sandbox.assert.calledTwice(errorListener)
            sandbox.assert.calledTwice(sqs.send.withArgs(sinon.match.instanceOf(ReceiveMessageCommand)))
        })

        it("waits before repolling when a 403 error occurs", async () => {
            const invalidSignatureErr = {
                statusCode: 403,
                message: "The security token included in the request is invalid",
            }
            sqs.send = overrideRejectStub(ReceiveMessageCommand, invalidSignatureErr)
            const errorListener = sandbox.stub()
            consumer.on("error", errorListener)

            consumer.start()
            await clock.tickAsync(AUTHENTICATION_ERROR_TIMEOUT)
            consumer.stop()

            sandbox.assert.calledTwice(errorListener)
            sandbox.assert.calledTwice(sqs.send.withArgs(sinon.match.instanceOf(ReceiveMessageCommand)))
        })

        it("waits before repolling when a UnknownEndpoint error occurs", async () => {
            const unknownEndpointErr = {
                code: "UnknownEndpoint",
                message:
                    "Inaccessible host: `sqs.eu-west-1.amazonaws.com`. This service may not be available in the `eu-west-1` region.",
            }
            sqs.send = overrideRejectStub(ReceiveMessageCommand, unknownEndpointErr)
            const errorListener = sandbox.stub()
            consumer.on("error", errorListener)

            consumer.start()
            await clock.tickAsync(AUTHENTICATION_ERROR_TIMEOUT)
            consumer.stop()

            sandbox.assert.calledTwice(errorListener)
            sandbox.assert.calledTwice(sqs.send.withArgs(sinon.match.instanceOf(ReceiveMessageCommand)))
        })

        it("waits before repolling when a polling timeout is set", async () => {
            consumer = new Consumer({
                queueUrl: "some-queue-url.fifo",
                region: "some-region",
                handleMessage,
                sqs,
                authenticationErrorTimeout: 20,
                pollingWaitTimeMs: 100,
            })

            consumer.start()
            await clock.tickAsync(POLLING_TIMEOUT)
            consumer.stop()

            // TODO fix this
            sandbox.assert.calledTwice(sqs.send.withArgs(sinon.match.instanceOf(ReceiveMessageCommand)))
        })

        it("fires a message_received event when a message is received", async () => {
            consumer.start()
            const message = await pEvent(consumer, "message_received")
            consumer.stop()

            assert.deepEqual(message, response.Messages[0])
        })

        it("fires a message_processed event when a message is successfully deleted", async () => {
            handleMessage.resolves()

            consumer.start()
            const message = await pEvent(consumer, "message_received")
            consumer.stop()

            assert.deepEqual(message, response.Messages[0])
        })

        it("calls the handleMessage function when a message is received", async () => {
            consumer.start()
            await pEvent(consumer, "message_processed")
            consumer.stop()

            sandbox.assert.calledWith(handleMessage, response.Messages[0])
        })

        it("deletes the message when the handleMessage function is called", async () => {
            handleMessage.resolves()

            consumer.start()
            await pEvent(consumer, "message_processed")
            consumer.stop()

            sandbox.assert.calledWith(
                sqs.send,
                sinon.match
                    .instanceOf(DeleteMessageCommand)
                    .and(
                        sinon.match.has("input", { QueueUrl: "some-queue-url.fifo", ReceiptHandle: "receipt-handle" }),
                    ),
            )
        })

        it("doesn't delete the message when a processing error is reported", async () => {
            handleMessage.rejects(new Error("Processing error"))

            consumer.start()
            await pEvent(consumer, "processing_error")
            consumer.stop()

            sandbox.assert.notCalled(sqs.send.withArgs(sinon.match.instanceOf(DeleteMessageCommand)))
        })

        it("consumes another message once one is processed", async () => {
            handleMessage.onSecondCall().callsFake(consumer.stop).resolves()

            consumer.start()
            await clock.runToLastAsync()

            sandbox.assert.calledTwice(handleMessage)
        })

        it("doesn't consume more messages when called multiple times", () => {
            sqs.send = overrideResolveStub(ReceiveMessageCommand, new Promise((res) => setTimeout(res, 100)))
            consumer.start()
            consumer.start()
            consumer.start()
            consumer.start()
            consumer.start()
            consumer.stop()

            sandbox.assert.calledOnce(sqs.send)
        })

        it("consumes multiple messages when the batchSize is greater than 1", async () => {
            sqs.send = overrideResolveStub(ReceiveMessageCommand, {
                Messages: [
                    {
                        ReceiptHandle: "receipt-handle-1",
                        MessageId: "1",
                        Body: "body-1",
                    },
                    {
                        ReceiptHandle: "receipt-handle-2",
                        MessageId: "2",
                        Body: "body-2",
                    },
                    {
                        ReceiptHandle: "receipt-handle-3",
                        MessageId: "3",
                        Body: "body-3",
                    },
                ],
            })

            consumer = new Consumer({
                queueUrl: "some-queue-url.fifo",
                messageAttributeNames: ["attribute-1", "attribute-2"],
                region: "some-region",
                handleMessage,
                batchSize: 3,
                sqs,
            })

            consumer.start()

            await clock.nextAsync()
            await clock.nextAsync()

            sandbox.assert.calledWith(
                sqs.send,
                sinon.match.instanceOf(ReceiveMessageCommand).and(
                    sinon.match.has("input", {
                        QueueUrl: "some-queue-url.fifo",
                        MessageAttributeNames: ["attribute-1", "attribute-2"],
                        AttributeNames: ["MessageGroupId"],
                        MaxNumberOfMessages: 3,
                        WaitTimeSeconds: 20,
                        VisibilityTimeout: 30,
                    }),
                ),
            )
            sandbox.assert.callCount(handleMessage, 3)

            consumer.stop()
        })

        it("removes the messages with same group id if the first handling fails", async () => {
            sqs.send = overrideResolveStub(ReceiveMessageCommand, {
                Messages: [
                    {
                        ReceiptHandle: "receipt-handle-1",
                        MessageId: "1",
                        Body: "body-1",
                        Attributes: {
                            MessageGroupId: "group-1",
                        },
                    },
                    {
                        ReceiptHandle: "receipt-handle-2",
                        MessageId: "2",
                        Body: "body-2",
                        Attributes: {
                            MessageGroupId: "group-1",
                        },
                    },
                    {
                        ReceiptHandle: "receipt-handle-3",
                        MessageId: "3",
                        Body: "body-3",
                        Attributes: {
                            MessageGroupId: "group-1",
                        },
                    },
                ],
            })

            const handleMessage = sandbox.stub().rejects(new Error("Processing error"))

            consumer = new Consumer({
                queueUrl: "some-queue-url.fifo",
                messageAttributeNames: ["attribute-1", "attribute-2"],
                region: "some-region",
                handleMessage,
                batchSize: 3,
                sqs,
            })

            consumer.start()

            await clock.nextAsync()
            await clock.nextAsync()

            sandbox.assert.calledWith(
                sqs.send,
                sinon.match.instanceOf(ReceiveMessageCommand).and(
                    sinon.match.has("input", {
                        QueueUrl: "some-queue-url.fifo",
                        MessageAttributeNames: ["attribute-1", "attribute-2"],
                        AttributeNames: ["MessageGroupId"],
                        MaxNumberOfMessages: 3,
                        WaitTimeSeconds: 20,
                        VisibilityTimeout: 30,
                    }),
                ),
            )
            sandbox.assert.calledOnce(handleMessage)
            sandbox.assert.calledWith(
                sqs.send,
                sinon.match.instanceOf(ChangeMessageVisibilityBatchCommand).and(
                    sinon.match.has("input", {
                        QueueUrl: "some-queue-url.fifo",
                        Entries: [
                            { Id: "1", ReceiptHandle: "receipt-handle-1", VisibilityTimeout: 30 },
                            { Id: "2", ReceiptHandle: "receipt-handle-2", VisibilityTimeout: 30 },
                            { Id: "3", ReceiptHandle: "receipt-handle-3", VisibilityTimeout: 30 },
                        ],
                    }),
                ),
            )

            consumer.stop()
        })

        it("consumes messages with message attribute 'ApproximateReceiveCount'", async () => {
            const messageWithAttr = {
                ReceiptHandle: "receipt-handle-1",
                MessageId: "1",
                Body: "body-1",
                Attributes: {
                    ApproximateReceiveCount: 1,
                },
            }

            sqs.send = overrideResolveStub(ReceiveMessageCommand, {
                Messages: [messageWithAttr],
            })

            consumer = new Consumer({
                queueUrl: "some-queue-url.fifo",
                attributeNames: ["ApproximateReceiveCount"],
                region: "some-region",
                handleMessage,
                sqs,
            })

            consumer.start()
            const message = await pEvent(consumer, "message_received")
            consumer.stop()

            sandbox.assert.calledWith(
                sqs.send,
                sinon.match.instanceOf(ReceiveMessageCommand).and(
                    sinon.match.has("input", {
                        QueueUrl: "some-queue-url.fifo",
                        AttributeNames: ["ApproximateReceiveCount", "MessageGroupId"],
                        MessageAttributeNames: ["All"],
                        MaxNumberOfMessages: 10,
                        WaitTimeSeconds: 20,
                        VisibilityTimeout: 30,
                    }),
                ),
            )

            assert.equal(message, messageWithAttr)
        })

        it("fires an emptyQueue event when all messages have been consumed", async () => {
            sqs.send = overrideResolveStub(ReceiveMessageCommand, {
                Messages: [],
            })

            consumer.start()
            await pEvent(consumer, "empty")
            consumer.stop()
        })

        it("terminate message visibility timeout on processing error", async () => {
            handleMessage.rejects(new Error("Processing error"))

            consumer.terminateVisibilityTimeout = true

            consumer.start()
            await pEvent(consumer, "processing_error")
            consumer.stop()

            sandbox.assert.calledWith(
                sqs.send,
                sinon.match.instanceOf(ChangeMessageVisibilityCommand).and(
                    sinon.match.has("input", {
                        QueueUrl: "some-queue-url.fifo",
                        ReceiptHandle: "receipt-handle",
                        VisibilityTimeout: 0,
                    }),
                ),
            )
        })

        it("does not terminate visibility timeout when `terminateVisibilityTimeout` option is false", async () => {
            handleMessage.rejects(new Error("Processing error"))
            consumer.terminateVisibilityTimeout = false

            consumer.start()
            await pEvent(consumer, "processing_error")
            consumer.stop()

            sandbox.assert.notCalled(sqs.send.withArgs(sinon.match.instanceOf(ChangeMessageVisibilityCommand)))
        })

        it("fires error event when failed to terminate visibility timeout on processing error", async () => {
            handleMessage.rejects(new Error("Processing error"))

            const sqsError = new Error("Processing error")
            sqsError.name = "SQSError"
            sqs.send = overrideRejectStub(ChangeMessageVisibilityCommand, sqsError)
            consumer.terminateVisibilityTimeout = true

            consumer.start()
            await pEvent(consumer, "error")
            consumer.stop()

            sandbox.assert.calledWith(
                sqs.send,
                sinon.match.instanceOf(ChangeMessageVisibilityCommand).and(
                    sinon.match.has("input", {
                        QueueUrl: "some-queue-url.fifo",
                        ReceiptHandle: "receipt-handle",
                        VisibilityTimeout: 0,
                    }),
                ),
            )
        })

        it("passes in the correct visibility timeout for long running handler functions", async () => {
            sqs.send = overrideResolveStub(ReceiveMessageCommand, {
                Messages: [
                    { MessageId: "1", ReceiptHandle: "receipt-handle-1", Body: "body-1" },
                    { MessageId: "2", ReceiptHandle: "receipt-handle-2", Body: "body-2" },
                    { MessageId: "3", ReceiptHandle: "receipt-handle-3", Body: "body-3" },
                ],
            })
            consumer = new Consumer({
                queueUrl: "some-queue-url.fifo",
                region: "some-region",
                handleMessage: () => new Promise((resolve) => setTimeout(resolve, 75000)),
                batchSize: 3,
                sqs,
                visibilityTimeout: 40,
                heartbeatInterval: 30,
            })
            const clearIntervalSpy = sinon.spy(global, "clearInterval")

            consumer.start()
            await clock.tickAsync(75000)
            consumer.stop()

            sandbox.assert.calledWith(
                sqs.send,
                sinon.match.instanceOf(ChangeMessageVisibilityBatchCommand).and(
                    sinon.match.has("input", {
                        QueueUrl: "some-queue-url.fifo",
                        Entries: [
                            { Id: "1", ReceiptHandle: "receipt-handle-1", VisibilityTimeout: 70 },
                            { Id: "2", ReceiptHandle: "receipt-handle-2", VisibilityTimeout: 70 },
                            { Id: "3", ReceiptHandle: "receipt-handle-3", VisibilityTimeout: 70 },
                        ],
                    }),
                ),
            )
            sandbox.assert.calledWith(
                sqs.send,
                sinon.match.instanceOf(ChangeMessageVisibilityBatchCommand).and(
                    sinon.match.has("input", {
                        QueueUrl: "some-queue-url.fifo",
                        Entries: [
                            { Id: "1", ReceiptHandle: "receipt-handle-1", VisibilityTimeout: 100 },
                            { Id: "2", ReceiptHandle: "receipt-handle-2", VisibilityTimeout: 100 },
                            { Id: "3", ReceiptHandle: "receipt-handle-3", VisibilityTimeout: 100 },
                        ],
                    }),
                ),
            )
            sandbox.assert.calledOnce(clearIntervalSpy)
        })
    })

    describe(".stop", () => {
        it("stops the consumer polling for messages", async () => {
            consumer.start()
            consumer.stop()

            await Promise.all([pEvent(consumer, "stopped"), clock.runAllAsync()])

            sandbox.assert.calledOnce(handleMessage)
        })

        it("fires a stopped event when last poll occurs after stopping", async () => {
            consumer.start()
            consumer.stop()
            await Promise.all([pEvent(consumer, "stopped"), clock.runAllAsync()])
        })

        it("fires a stopped event only once when stopped multiple times", async () => {
            const handleStop = sandbox.stub().returns(null)

            consumer.on("stopped", handleStop)

            consumer.start()
            consumer.stop()
            consumer.stop()
            consumer.stop()
            await clock.runAllAsync()

            sandbox.assert.calledOnce(handleStop)
        })

        it("fires a stopped event a second time if started and stopped twice", async () => {
            const handleStop = sandbox.stub().returns(null)

            consumer.on("stopped", handleStop)

            consumer.start()
            consumer.stop()
            consumer.start()
            consumer.stop()
            await clock.runAllAsync()

            sandbox.assert.calledTwice(handleStop)
        })
    })

    describe("isRunning", async () => {
        it("returns true if the consumer is polling", () => {
            consumer.start()
            assert.isTrue(consumer.isRunning)
            consumer.stop()
        })

        it("returns false if the consumer is not polling", () => {
            consumer.start()
            consumer.stop()
            assert.isFalse(consumer.isRunning)
        })
    })
})
