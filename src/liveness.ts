/** Default long-poll receive timeout; should exceed WaitTimeSeconds plus margin. */
export const DEFAULT_POLL_RECEIVE_TIMEOUT_MS = 35_000

/**
 * Tracks SQS long-poll cycle progress for ALB /ping liveness.
 * Distinct from visibility-timeout heartbeat (heartbeatInterval on Consumer).
 */
export class PollLiveness {
    private lastReceiveMessageCompletedAt: number
    private receiveMessageStartedAt: number | null
    private readonly pollReceiveTimeoutMs: number

    constructor(pollReceiveTimeoutMs: number = DEFAULT_POLL_RECEIVE_TIMEOUT_MS) {
        this.pollReceiveTimeoutMs = pollReceiveTimeoutMs
        this.lastReceiveMessageCompletedAt = Date.now()
        this.receiveMessageStartedAt = null
    }

    markStarted(): void {
        this.lastReceiveMessageCompletedAt = Date.now()
        this.receiveMessageStartedAt = null
    }

    onPollStarted(): void {
        this.receiveMessageStartedAt = Date.now()
    }

    onPollCompleted(): void {
        this.lastReceiveMessageCompletedAt = Date.now()
        this.receiveMessageStartedAt = null
    }

    getLastPollCompletedAt(): number {
        return this.lastReceiveMessageCompletedAt
    }

    secondsSincePollCompleted(nowMs: number = Date.now()): number {
        return Math.floor((nowMs - this.lastReceiveMessageCompletedAt) / 1000)
    }

    secondsSincePollActivity(nowMs: number = Date.now()): number {
        if (this.receiveMessageStartedAt !== null && nowMs - this.receiveMessageStartedAt > this.pollReceiveTimeoutMs) {
            return Math.floor((nowMs - this.receiveMessageStartedAt) / 1000)
        }
        return this.secondsSincePollCompleted(nowMs)
    }

    isPollHealthy(maxStaleSeconds: number = 60, nowMs: number = Date.now()): boolean {
        if (this.receiveMessageStartedAt !== null && nowMs - this.receiveMessageStartedAt > this.pollReceiveTimeoutMs) {
            return false
        }
        return this.secondsSincePollCompleted(nowMs) <= maxStaleSeconds
    }
}
