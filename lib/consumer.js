"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Consumer = void 0;
const SQS = require("aws-sdk/clients/sqs");
const events_1 = require("events");
const bind_1 = require("./bind");
const errors_1 = require("./errors");
const utils_1 = require("./utils");
function createTimeout(duration) {
    let timeout = null;
    const pending = new Promise((_, reject) => {
        timeout = setTimeout(() => {
            reject(new errors_1.TimeoutError());
        }, duration);
    });
    return { timeout: timeout, pending: pending };
}
function isConnectionError(err) {
    if (err instanceof errors_1.SQSError) {
        return err.statusCode === 403 || err.code === "CredentialsError" || err.code === "UnknownEndpoint";
    }
    return false;
}
function toSQSError(err, message) {
    const sqsError = new errors_1.SQSError(message);
    sqsError.code = err.code;
    sqsError.statusCode = err.statusCode;
    sqsError.region = err.region;
    sqsError.retryable = err.retryable;
    sqsError.hostname = err.hostname;
    sqsError.time = err.time;
    return sqsError;
}
class Consumer extends events_1.EventEmitter {
    constructor(options) {
        super();
        this.queueUrl = options.queueUrl;
        this.handleMessage = options.handleMessage;
        this.handleMessageTimeout = options.handleMessageTimeout;
        this.attributeNames = Array.from(new Set([...(options.attributeNames || []), "MessageGroupId"]));
        this.messageAttributeNames = options.messageAttributeNames || ["All"];
        this.stopped = true;
        this.batchSize = options.batchSize || 10;
        this.visibilityTimeout = options.visibilityTimeout || 30;
        this.terminateVisibilityTimeout = options.terminateVisibilityTimeout || false;
        this.heartbeatInterval = options.heartbeatInterval || 5;
        this.waitTimeSeconds = options.waitTimeSeconds || 20;
        this.authenticationErrorTimeout = options.authenticationErrorTimeout || 10000;
        this.pollingWaitTimeMs = options.pollingWaitTimeMs || 10;
        this.pendingMessages = [];
        this.sqs =
            options.sqs ||
                new SQS({
                    region: options.region || process.env.AWS_REGION || "eu-west-1",
                });
        this.assertOptions();
        bind_1.autoBind(this);
    }
    assertOptions() {
        if (this.batchSize < 1) {
            throw new Error("SQS batchSize option must be greater than zero.");
        }
        if (this.heartbeatInterval != null && this.heartbeatInterval >= this.visibilityTimeout) {
            throw new Error("heartbeatInterval must be less than visibilityTimeout.");
        }
    }
    emit(event, ...args) {
        return super.emit(event, ...args);
    }
    on(event, listener) {
        return super.on(event, listener);
    }
    once(event, listener) {
        return super.once(event, listener);
    }
    get isRunning() {
        return !this.stopped;
    }
    static create(options) {
        return new Consumer(options);
    }
    start() {
        if (this.stopped) {
            this.stopped = false;
            this.pollSqs();
            this.startHeartbeat();
        }
    }
    stop() {
        this.stopped = true;
        this.stopHeartbeat();
    }
    pollSqs() {
        if (this.stopped) {
            this.emit("stopped");
            return;
        }
        const receiveParams = Object.assign({ QueueUrl: this.queueUrl, AttributeNames: this.attributeNames, MessageAttributeNames: this.messageAttributeNames, MaxNumberOfMessages: Math.min(10, this.batchSize), WaitTimeSeconds: this.waitTimeSeconds }, (this.visibilityTimeout ? { VisibilityTimeout: this.visibilityTimeout } : null));
        let currentPollingTimeout = this.pollingWaitTimeMs;
        this.receiveMessage(receiveParams)
            .then(this.addToPendingMessages)
            .catch((err) => {
            this.emit("error", err);
            if (isConnectionError(err)) {
                currentPollingTimeout = this.authenticationErrorTimeout;
            }
            return;
        })
            .then(() => {
            if (this.pendingMessages.length < this.batchSize) {
                setTimeout(this.pollSqs, currentPollingTimeout);
            }
        })
            .catch((err) => {
            this.emit("error", err);
        });
    }
    addToPendingMessages(response) {
        if (!response || !response.Messages) {
            return;
        }
        if (response.Messages.length === 0) {
            //this.emit("empty")
            return;
        }
        const current = Date.now();
        const batch = response.Messages.map((message) => ({
            sqsMessage: message,
            processing: false,
            arrivedAt: current,
        }));
        this.pendingMessages.push(...batch);
        this.processNextPendingMessage();
    }
    processNextPendingMessage() {
        const message = utils_1.getNextPendingMessage(this.pendingMessages);
        if (!message) {
            return;
        }
        message.processing = true;
        this.processMessage(message.sqsMessage).then(() => {
            setImmediate(this.processNextPendingMessage);
        });
        setImmediate(this.processNextPendingMessage);
    }
    processMessage(message) {
        return __awaiter(this, void 0, void 0, function* () {
            this.emit("message_received", message);
            try {
                yield this.executeHandler(message);
                yield this.deleteMessage(message);
                this.emit("message_processed", message);
            }
            catch (err) {
                this.emitError(err, message);
                if (this.terminateVisibilityTimeout) {
                    yield this.changeVisibilityTimeout(message, 0);
                }
            }
        });
    }
    receiveMessage(params) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return yield this.sqs.receiveMessage(params).promise();
            }
            catch (err) {
                throw toSQSError(err, `SQS receive message failed: ${err.message}`);
            }
        });
    }
    deleteMessage(message) {
        return __awaiter(this, void 0, void 0, function* () {
            const deleteParams = {
                QueueUrl: this.queueUrl,
                ReceiptHandle: message.ReceiptHandle || "",
            };
            try {
                // delete from pending messages
                const messageIndex = this.pendingMessages.findIndex((m) => m.sqsMessage.MessageId === message.MessageId);
                this.pendingMessages.splice(messageIndex);
                yield this.sqs.deleteMessage(deleteParams).promise();
            }
            catch (err) {
                throw toSQSError(err, `SQS delete message failed: ${err.message}`);
            }
        });
    }
    executeHandler(message) {
        return __awaiter(this, void 0, void 0, function* () {
            let timeout;
            try {
                if (this.handleMessageTimeout) {
                    timeout = createTimeout(this.handleMessageTimeout);
                    yield Promise.race([this.handleMessage(message), timeout.pending]);
                }
                else {
                    yield this.handleMessage(message);
                }
            }
            catch (err) {
                if (err instanceof errors_1.TimeoutError) {
                    err.message = `Message handler timed out after ${this.handleMessageTimeout}ms: Operation timed out.`;
                }
                else {
                    err.message = `Unexpected message handler failure: ${err.message}`;
                }
                throw err;
            }
            finally {
                if (timeout && timeout.timeout) {
                    clearTimeout(timeout.timeout);
                }
            }
        });
    }
    changeVisibilityTimeout(message, timeout) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return this.sqs
                    .changeMessageVisibility({
                    QueueUrl: this.queueUrl,
                    ReceiptHandle: message.ReceiptHandle || "",
                    VisibilityTimeout: timeout,
                })
                    .promise();
            }
            catch (err) {
                this.emit("error", err, message);
            }
        });
    }
    emitError(err, message) {
        if (err.name === errors_1.SQSError.name) {
            this.emit("error", err, message);
        }
        else if (err instanceof errors_1.TimeoutError) {
            this.emit("timeout_error", err, message);
        }
        else {
            this.emit("processing_error", err, message);
        }
    }
    changeVisibilityTimeoutBatch(messages, timeout) {
        return __awaiter(this, void 0, void 0, function* () {
            const params = {
                QueueUrl: this.queueUrl,
                Entries: messages.map((message) => ({
                    Id: message.MessageId || "",
                    ReceiptHandle: message.ReceiptHandle || "",
                    VisibilityTimeout: timeout,
                })),
            };
            try {
                return this.sqs.changeMessageVisibilityBatch(params).promise();
            }
            catch (err) {
                this.emit("error", err, messages);
            }
        });
    }
    startHeartbeat() {
        this.heartbeatTimeout = setInterval(() => __awaiter(this, void 0, void 0, function* () {
            const now = Date.now();
            const batches = utils_1.groupMessageBatchByArrivedTime(this.pendingMessages);
            for (const b of batches) {
                const elapsedSeconds = Math.ceil((now - b[0].arrivedAt) / 1000);
                yield this.changeVisibilityTimeoutBatch(b.map((a) => a.sqsMessage), elapsedSeconds + (this.visibilityTimeout || 0));
            }
        }), this.heartbeatInterval * 1000);
    }
    stopHeartbeat() {
        clearInterval(this.heartbeatTimeout);
    }
}
exports.Consumer = Consumer;
//# sourceMappingURL=consumer.js.map