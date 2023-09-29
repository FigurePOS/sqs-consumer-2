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
const events_1 = require("events");
const bind_1 = require("./bind");
const errors_1 = require("./errors");
const utils_1 = require("./utils");
const client_sqs_1 = require("@aws-sdk/client-sqs");
class Consumer extends events_1.EventEmitter {
    constructor(options) {
        super();
        this.queueUrl = options.queueUrl;
        this.handleMessage = options.handleMessage;
        this.handleMessageTimeout = options.handleMessageTimeout;
        this.attributeNames = Array.from(new Set([...(options.attributeNames || []), "MessageGroupId"]));
        this.messageAttributeNames = options.messageAttributeNames || ["All"];
        this.stopped = true;
        this.pollingStopped = true;
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
                new client_sqs_1.SQS({
                    region: options.region || process.env.AWS_REGION || "us-east-1",
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
        this.pollingStopped = false;
        const receiveParams = Object.assign({ QueueUrl: this.queueUrl, AttributeNames: this.attributeNames, MessageAttributeNames: this.messageAttributeNames, MaxNumberOfMessages: Math.min(10, this.batchSize), WaitTimeSeconds: this.waitTimeSeconds }, (this.visibilityTimeout ? { VisibilityTimeout: this.visibilityTimeout } : null));
        let currentPollingTimeout = this.pollingWaitTimeMs;
        this.receiveMessage(receiveParams)
            .then(this.addToPendingMessages)
            .catch((err) => {
            this.emit("error", err);
            if (utils_1.isConnectionError(err)) {
                currentPollingTimeout = this.authenticationErrorTimeout;
            }
            return;
        })
            .then(() => {
            if (!this.stopped && utils_1.isPollingReadyForNextReceive(this.batchSize, this.pendingMessages.length)) {
                setTimeout(this.pollSqs, currentPollingTimeout);
            }
            else {
                this.pollingStopped = true;
            }
        })
            .catch((err) => {
            this.emit("error", err);
        });
    }
    addToPendingMessages(response) {
        if (!response || !response.Messages || response.Messages.length === 0) {
            if (this.pendingMessages.length === 0) {
                this.emit("empty");
            }
            return;
        }
        this.emit("batch_received");
        const current = Date.now();
        const batch = response.Messages.map((message) => ({
            sqsMessage: message,
            processing: false,
            arrivedAt: current,
            processingStartedAt: null,
        }));
        this.pendingMessages.push(...batch);
        this.emitPendingStatus();
        this.processNextPendingMessage();
    }
    processNextPendingMessage() {
        const message = utils_1.getNextPendingMessage(this.pendingMessages);
        if (!message) {
            return;
        }
        message.processing = true;
        message.processingStartedAt = Date.now();
        this.processMessage(message).then(() => {
            setImmediate(this.processNextPendingMessage);
            if (this.pollingStopped && utils_1.isPollingReadyForNextReceive(this.batchSize, this.pendingMessages.length)) {
                setImmediate(this.pollSqs);
            }
        });
        setImmediate(this.processNextPendingMessage);
    }
    processMessage(message) {
        return __awaiter(this, void 0, void 0, function* () {
            const sqsMsg = message.sqsMessage;
            this.emit("message_received", sqsMsg);
            try {
                yield this.executeHandler(sqsMsg);
                const processedTime = Date.now();
                this.emit("message_processed", sqsMsg, {
                    arrivedAt: message.arrivedAt,
                    processingStartedAt: message.processingStartedAt,
                    processedAt: processedTime,
                    waitingTime: message.processingStartedAt - message.arrivedAt,
                    processingTime: processedTime - message.processingStartedAt,
                    totalTime: processedTime - message.arrivedAt,
                });
                yield this.deleteMessage(sqsMsg);
            }
            catch (err) {
                this.emitError(err, sqsMsg);
                if (this.terminateVisibilityTimeout) {
                    yield this.changeVisibilityTimeout(sqsMsg, 0);
                }
            }
        });
    }
    receiveMessage(params) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                return yield this.sqs.receiveMessage(params);
            }
            catch (err) {
                throw utils_1.toSQSError(err, `SQS receive message failed: ${err.message}`);
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
                yield this.sqs.deleteMessage(deleteParams);
                // delete from pending messages
                this.pendingMessages = this.pendingMessages.filter((m) => m.sqsMessage.MessageId !== message.MessageId);
                this.emitPendingStatus();
            }
            catch (err) {
                // delete from pending messages
                this.pendingMessages = this.pendingMessages.filter((m) => m.sqsMessage.MessageId !== message.MessageId);
                this.emitPendingStatus();
                throw utils_1.toSQSError(err, `SQS delete message failed: ${err.message}`);
            }
        });
    }
    executeHandler(message) {
        return __awaiter(this, void 0, void 0, function* () {
            let timeout;
            try {
                if (this.handleMessageTimeout) {
                    timeout = utils_1.createTimeout(this.handleMessageTimeout);
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
                // processing has failed, remove all following messages with the same groupId
                this.pendingMessages = utils_1.filterOutByGroupId(this.pendingMessages, message);
                this.emitPendingStatus();
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
                return yield this.sqs.changeMessageVisibility({
                    QueueUrl: this.queueUrl,
                    ReceiptHandle: message.ReceiptHandle || "",
                    VisibilityTimeout: timeout,
                });
            }
            catch (err) {
                this.emit("error", utils_1.toSQSError(err, `Error changing visibility timeout: ${err.message}`), message);
            }
        });
    }
    emitPendingStatus() {
        this.emit("pending_status", {
            messagesProcessing: this.pendingMessages.filter((m) => m.processing === true).length,
            messagesWaiting: this.pendingMessages.filter((m) => m.processing === false).length,
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
                return yield this.sqs.changeMessageVisibilityBatch(params);
            }
            catch (err) {
                this.emit("error", utils_1.toSQSError(err, `Error changing visibility timeout batch: ${err.message}`), messages);
            }
        });
    }
    startHeartbeat() {
        this.heartbeatTimeout = setInterval(() => __awaiter(this, void 0, void 0, function* () {
            const now = Date.now();
            const batches = utils_1.groupMessageBatchByArrivedTime(this.pendingMessages);
            for (const batch of batches) {
                const elapsedSeconds = Math.ceil((now - batch[0].arrivedAt) / 1000);
                const timeout = elapsedSeconds + (this.visibilityTimeout || 0);
                const visibilityResponse = yield this.changeVisibilityTimeoutBatch(batch.map((a) => a.sqsMessage), timeout);
                this.emit("visibility_timeout_changed", batch, visibilityResponse, elapsedSeconds, timeout);
            }
        }), this.heartbeatInterval * 1000);
    }
    stopHeartbeat() {
        clearInterval(this.heartbeatTimeout);
    }
}
exports.Consumer = Consumer;
//# sourceMappingURL=consumer.js.map