/** Default long-poll receive timeout; should exceed WaitTimeSeconds plus margin. */
export const DEFAULT_POLL_RECEIVE_TIMEOUT_MS = 35_000

/**
 * Tracks SQS long-poll activity for ALB /ping liveness.
 * Distinct from visibility-timeout heartbeat (heartbeatInterval on Consumer).
 */
export class PollLiveness {
    private lastPollActivityTimestamp: number
    private receiveMessageStartedTimestamp: number | null
    private readonly pollReceiveTimeoutMs: number

    constructor(pollReceiveTimeoutMs: number = DEFAULT_POLL_RECEIVE_TIMEOUT_MS) {
        this.pollReceiveTimeoutMs = pollReceiveTimeoutMs
        this.lastPollActivityTimestamp = Date.now()
        this.receiveMessageStartedTimestamp = null
    }

    markStarted(): void {
        this.lastPollActivityTimestamp = Date.now()
        this.receiveMessageStartedTimestamp = null
    }

    onPollStarted(): void {
        this.receiveMessageStartedTimestamp = Date.now()
    }

    onPollCompleted(): void {
        this.lastPollActivityTimestamp = Date.now()
        this.receiveMessageStartedTimestamp = null
    }

    markConsumerError(): void {
        this.lastPollActivityTimestamp = Date.now()
    }

    getLastPollActivityTimestamp(): number {
        return this.lastPollActivityTimestamp
    }

    secondsSincePollActivity(nowMs: number = Date.now()): number {
        if (this.receiveMessageStartedTimestamp !== null && nowMs - this.receiveMessageStartedTimestamp > this.pollReceiveTimeoutMs) {
            return Math.floor((nowMs - this.receiveMessageStartedTimestamp) / 1000)
        }
        return Math.floor((nowMs - this.lastPollActivityTimestamp) / 1000)
    }

    isPollHealthy(maxStaleSeconds: number = 60, nowMs: number = Date.now()): boolean {
        if (this.receiveMessageStartedTimestamp !== null && nowMs - this.receiveMessageStartedTimestamp > this.pollReceiveTimeoutMs) {
            return false
        }
        return this.secondsSincePollActivity(nowMs) <= maxStaleSeconds
    }
}
