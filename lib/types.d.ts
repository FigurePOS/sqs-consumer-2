/// <reference types="node" />
import { Message, SQSClient } from "@aws-sdk/client-sqs";
export interface TimeoutResponse {
    timeout: NodeJS.Timeout | null;
    pending: Promise<void>;
}
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
    sqs?: SQSClient;
    region?: string;
    handleMessageTimeout?: number;
    handleMessage(message: Message): Promise<void>;
}
export interface Events {
    empty: [];
    message_received: [Message];
    message_processed: [Message, any];
    error: [Error, void | Message | Message[]];
    timeout_error: [Error, Message];
    processing_error: [Error, Message];
    stopped: [];
    pending_status: [PendingStatus];
    batch_received: [];
    visibility_timeout_changed: [PendingMessages, any, number, number];
}
export declare type PendingStatus = {
    messagesProcessing: number;
    messagesWaiting: number;
};
export declare type PendingMessage = {
    sqsMessage: Message;
    processing: boolean;
    arrivedAt: number;
    processingStartedAt: number | null;
};
export declare type PendingMessages = PendingMessage[];
