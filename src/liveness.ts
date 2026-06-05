/** Default long-poll receive timeout; should exceed WaitTimeSeconds plus margin. */
export const DEFAULT_POLL_RECEIVE_TIMEOUT_MS = 35_000

/**
 * Tracks SQS long-poll activity for ALB /ping liveness.
 * Distinct from visibility-timeout heartbeat (heartbeatInterval on Consumer).
 */
export class PollLiveness {
    private lastPollActivityAt: number
    private receiveMessageStartedAt: number | null
    private readonly pollReceiveTimeoutMs: number

    constructor(pollReceiveTimeoutMs: number = DEFAULT_POLL_RECEIVE_TIMEOUT_MS) {
        this.pollReceiveTimeoutMs = pollReceiveTimeoutMs
        this.lastPollActivityAt = Date.now()
        this.receiveMessageStartedAt = null
    }

    markStarted(): void {
        this.lastPollActivityAt = Date.now()
        this.receiveMessageStartedAt = null
    }

    onPollStarted(): void {
        this.receiveMessageStartedAt = Date.now()
    }

    onPollCompleted(): void {
        this.lastPollActivityAt = Date.now()
        this.receiveMessageStartedAt = null
    }

    onConsumerError(): void {
        this.lastPollActivityAt = Date.now()
    }

    getLastPollActivityAt(): number {
        return this.lastPollActivityAt
    }

    secondsSincePollActivity(nowMs: number = Date.now()): number {
        if (this.receiveMessageStartedAt !== null && nowMs - this.receiveMessageStartedAt > this.pollReceiveTimeoutMs) {
            return Math.floor((nowMs - this.receiveMessageStartedAt) / 1000)
        }
        return Math.floor((nowMs - this.lastPollActivityAt) / 1000)
    }

    isPollHealthy(maxStaleSeconds: number = 60, nowMs: number = Date.now()): boolean {
        if (this.receiveMessageStartedAt !== null && nowMs - this.receiveMessageStartedAt > this.pollReceiveTimeoutMs) {
            return false
        }
        return this.secondsSincePollActivity(nowMs) <= maxStaleSeconds
    }
}
