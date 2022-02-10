import { PendingMessage, PendingMessages } from "./consumer";
export declare const getNextPendingMessage: (batch: PendingMessages) => PendingMessage | null;
export declare const groupMessageBatchByArrivedTime: (batch: PendingMessages) => PendingMessages[];
