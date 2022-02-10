"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.start = void 0;
const consumer_1 = require("./consumer");
exports.start = () => {
    const consumer = consumer_1.Consumer.create({
        queueUrl: "https://sqs.us-east-1.amazonaws.com/880892332156/_devstack_jirijanecek_PaymentService_Queue.fifo",
        handleMessage: (msg) => new Promise((res, rej) => setTimeout(() => {
            console.log(`processed ${msg.Body}`);
            res();
        }, 3000)),
        visibilityTimeout: 10,
        batchSize: 100,
    });
    consumer.start();
};
exports.start();
//# sourceMappingURL=index.js.map