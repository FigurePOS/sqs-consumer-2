/// <reference types="node" />
import * as SQS from "aws-sdk/clients/sqs";
export declare type SQSMessage = SQS.Types.Message;
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
    sqs?: SQS;
    region?: string;
    handleMessageTimeout?: number;
    handleMessage(message: SQSMessage): Promise<void>;
}
export interface Events {
    empty: [];
    message_received: [SQSMessage];
    message_processed: [SQSMessage, any];
    error: [Error, void | SQSMessage | SQSMessage[]];
    timeout_error: [Error, SQSMessage];
    processing_error: [Error, SQSMessage];
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
    sqsMessage: SQSMessage;
    processing: boolean;
    arrivedAt: number;
    processingStartedAt: number | null;
};
export declare type PendingMessages = PendingMessage[];
