import { PendingMessage, PendingMessages, TimeoutResponse } from "./types";
import { SQSError } from "./errors";
import { AWSError } from "aws-sdk";
export declare const getNextPendingMessage: (batch: PendingMessages) => PendingMessage | null;
export declare const groupMessageBatchByArrivedTime: (batch: PendingMessages) => PendingMessages[];
export declare const isPollingReadyForNextReceive: (batchSize: number, pendingSize: number) => boolean;
export declare const createTimeout: (duration: number) => TimeoutResponse;
export declare const isConnectionError: (err: Error) => boolean;
export declare const toSQSError: (err: AWSError, message: string) => SQSError;
