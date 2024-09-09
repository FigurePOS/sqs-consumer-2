import { Message } from "@aws-sdk/client-sqs";
import { SQSError } from "./errors";
import { PendingMessage, PendingMessages, TimeoutResponse } from "./types";
export declare const getNextPendingMessage: (batch: PendingMessages) => PendingMessage | null;
/**
 * Gets the first message batch from pending messages grouped by MessageGroupId
 * @param batch
 * @todo think of using generic function to group by any key
 */
export declare const getNextPendingMessageBatch: (batch: PendingMessages) => PendingMessages;
export declare const filterOutByGroupId: (pendingMessages: PendingMessages, msg: Message) => PendingMessages;
export declare const getMessagesByGroupId: (pendingMessages: PendingMessages, msg: Message) => PendingMessages;
export declare const groupMessageBatchByArrivedTime: (batch: PendingMessages) => PendingMessages[];
export declare const groupMessageBatchByGroupId: (batch: PendingMessage[]) => PendingMessage[][];
export declare const isPollingReadyForNextReceive: (batchSize: number, pendingSize: number) => boolean;
export declare const createTimeout: (duration: number) => TimeoutResponse;
export declare const isConnectionError: (err: Error) => boolean;
export declare const toSQSError: (err: any, message: string) => SQSError;
export declare const isFifo: (queueUrl: string) => boolean;
export declare const removeMessagesFromPending: (pendingMessages: PendingMessages, messages: Message[]) => PendingMessages;
