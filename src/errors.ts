class SQSError extends Error {
    code: string | null
    statusCode: number | null
    region: string | null
    hostname: string | null
    time: Date | null
    retryable: boolean | null

    constructor(message: string) {
        super(message)
        this.name = this.constructor.name
    }
}

class TimeoutError extends Error {
    constructor(message = "Operation timed out.") {
        super(message)
        this.message = message
        this.name = "TimeoutError"
    }
}

export { SQSError, TimeoutError }
