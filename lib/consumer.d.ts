/// <reference types="node" />
import * as SQS from "aws-sdk/clients/sqs";
import { EventEmitter } from "events";
export declare type SQSMessage = SQS.Types.Message;
export interface ConsumerOptions {
    queueUrl: string;
    attributeNames?: string[];
    messageAttributeNames?: string[];
    stopped?: boolean;
    batchSize?: number;
    visibilityTimeout?: number;
    waitTimeSeconds?: number;
    authenticationErrorTimeout?: number;
    pollingWaitTimeMs?: number;
    terminateVisibilityTimeout?: boolean;
    heartbeatInterval?: number;
    sqs?: SQS;
    region?: string;
    handleMessageTimeout?: number;
    handleMessage(message: SQSMessage): Promise<void>;
}
interface Events {
    response_processed: [];
    empty: [];
    message_received: [SQSMessage];
    message_processed: [SQSMessage];
    error: [Error, void | SQSMessage | SQSMessage[]];
    timeout_error: [Error, SQSMessage];
    processing_error: [Error, SQSMessage];
    stopped: [];
}
export declare type PendingMessage = {
    sqsMessage: SQSMessage;
    processing: boolean;
    arrivedAt: number;
};
export declare type PendingMessages = PendingMessage[];
export declare class Consumer extends EventEmitter {
    private readonly queueUrl;
    private readonly handleMessage;
    private readonly handleMessageTimeout;
    private readonly attributeNames;
    private readonly messageAttributeNames;
    private readonly batchSize;
    private readonly visibilityTimeout;
    private readonly waitTimeSeconds;
    private readonly authenticationErrorTimeout;
    private readonly pollingWaitTimeMs;
    private readonly terminateVisibilityTimeout;
    private readonly heartbeatInterval;
    private readonly sqs;
    private readonly pendingMessages;
    private stopped;
    private heartbeatTimeout;
    constructor(options: ConsumerOptions);
    private assertOptions;
    emit<T extends keyof Events>(event: T, ...args: Events[T]): boolean;
    on<T extends keyof Events>(event: T, listener: (...args: Events[T]) => void): this;
    once<T extends keyof Events>(event: T, listener: (...args: Events[T]) => void): this;
    get isRunning(): boolean;
    static create(options: ConsumerOptions): Consumer;
    start(): void;
    stop(): void;
    private pollSqs;
    private addToPendingMessages;
    private processNextPendingMessage;
    private processMessage;
    private receiveMessage;
    private deleteMessage;
    private executeHandler;
    private changeVisibilityTimeout;
    private emitError;
    private changeVisibilityTimeoutBatch;
    private startHeartbeat;
    private stopHeartbeat;
}
export {};
