"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.groupMessageBatchByArrivedTime = exports.getNextPendingMessage = void 0;
exports.getNextPendingMessage = (batch) => {
    return batch
        .filter((b) => {
        var _a;
        return !batch
            .filter((e) => { var _a; return e.processing && ((_a = e.sqsMessage.Attributes) === null || _a === void 0 ? void 0 : _a.MessageGroupId) != null; })
            .map((e) => { var _a; return (_a = e.sqsMessage.Attributes) === null || _a === void 0 ? void 0 : _a.MessageGroupId; })
            .includes((_a = b.sqsMessage.Attributes) === null || _a === void 0 ? void 0 : _a.MessageGroupId);
    })
        .find((b) => !b.processing);
};
exports.groupMessageBatchByArrivedTime = (batch) => {
    return [...new Set(batch.map((w) => w.arrivedAt))].map((arrived) => batch.filter((w) => w.arrivedAt === arrived));
};
//# sourceMappingURL=utils.js.map