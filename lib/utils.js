"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toSQSError = exports.isConnectionError = exports.createTimeout = exports.isPollingReadyForNextReceive = exports.groupMessageBatchByArrivedTime = exports.getNextPendingMessage = void 0;
const errors_1 = require("./errors");
exports.getNextPendingMessage = (batch) => {
    return batch
        .filter((msg) => {
        var _a;
        return !batch
            .filter((e) => { var _a; return e.processing && ((_a = e.sqsMessage.Attributes) === null || _a === void 0 ? void 0 : _a.MessageGroupId) != null; })
            .map((e) => { var _a; return (_a = e.sqsMessage.Attributes) === null || _a === void 0 ? void 0 : _a.MessageGroupId; })
            .includes((_a = msg.sqsMessage.Attributes) === null || _a === void 0 ? void 0 : _a.MessageGroupId);
    })
        .find((b) => !b.processing);
};
exports.groupMessageBatchByArrivedTime = (batch) => {
    return [...new Set(batch.map((w) => w.arrivedAt))].map((arrived) => batch.filter((w) => w.arrivedAt === arrived));
};
exports.isPollingReadyForNextReceive = (batchSize, pendingSize) => {
    return pendingSize + Math.min(10, batchSize) <= batchSize;
};
exports.createTimeout = (duration) => {
    let timeout = null;
    const pending = new Promise((_, reject) => {
        timeout = setTimeout(() => {
            reject(new errors_1.TimeoutError());
        }, duration);
    });
    return { timeout: timeout, pending: pending };
};
exports.isConnectionError = (err) => {
    if (err instanceof errors_1.SQSError) {
        return err.statusCode === 403 || err.code === "CredentialsError" || err.code === "UnknownEndpoint";
    }
    return false;
};
exports.toSQSError = (err, message) => {
    const sqsError = new errors_1.SQSError(message);
    sqsError.code = err.code;
    sqsError.statusCode = err.statusCode;
    sqsError.region = err.region;
    sqsError.retryable = err.retryable;
    sqsError.hostname = err.hostname;
    sqsError.time = err.time;
    return sqsError;
};
//# sourceMappingURL=utils.js.map