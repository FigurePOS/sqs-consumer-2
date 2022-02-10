declare class SQSError extends Error {
    code: string | null;
    statusCode: number | null;
    region: string | null;
    hostname: string | null;
    time: Date | null;
    retryable: boolean | null;
    constructor(message: string);
}
declare class TimeoutError extends Error {
    constructor(message?: string);
}
export { SQSError, TimeoutError };
