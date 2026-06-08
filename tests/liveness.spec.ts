import { assert } from "chai"
import * as sinon from "sinon"
import { PollLiveness } from "../src/liveness"

describe("PollLiveness", () => {
    let clock: sinon.SinonFakeTimers

    beforeEach(() => {
        clock = sinon.useFakeTimers(new Date("2026-06-04T12:00:00.000Z"))
    })

    afterEach(() => {
        clock.restore()
    })

    it("starts healthy after markStarted", () => {
        const liveness = new PollLiveness(35_000)

        assert.equal(liveness.isPollHealthy(60), true)
    })

    it("becomes unhealthy when no poll completes within maxStaleSeconds", () => {
        const liveness = new PollLiveness(35_000)

        clock.tick(61_000)

        assert.equal(liveness.isPollHealthy(60), false)
        assert.equal(liveness.secondsSincePollActivity(), 61)
    })

    it("onPollCompleted resets activity staleness", () => {
        const liveness = new PollLiveness(35_000)

        clock.tick(50_000)
        liveness.onPollStarted()
        liveness.onPollCompleted()
        clock.tick(50_000)

        assert.equal(liveness.isPollHealthy(60), true)
        assert.equal(liveness.secondsSincePollActivity(), 50)
    })

    it("becomes unhealthy when receive stays in flight past receiveTimeoutMs", () => {
        const liveness = new PollLiveness(35_000)

        liveness.onPollStarted()
        clock.tick(36_000)

        assert.equal(liveness.isPollHealthy(60), false)
        assert.equal(liveness.secondsSincePollActivity(), 36)
    })

    it("completing receive clears in-flight unhealthy state", () => {
        const liveness = new PollLiveness(35_000)

        liveness.onPollStarted()
        clock.tick(20_000)
        liveness.onPollCompleted()
        clock.tick(50_000)

        assert.equal(liveness.isPollHealthy(60), true)
    })

    it("markConsumerError resets activity staleness", () => {
        const liveness = new PollLiveness(35_000)

        clock.tick(50_000)
        liveness.markConsumerError()
        clock.tick(50_000)

        assert.equal(liveness.isPollHealthy(60), true)
        assert.equal(liveness.secondsSincePollActivity(), 50)
        assert.equal(liveness.getLastPollActivityTimestamp(), Date.parse("2026-06-04T12:00:50.000Z"))
    })

    it("markConsumerError does not hide a hung receive", () => {
        const liveness = new PollLiveness(35_000)

        liveness.onPollStarted()
        clock.tick(36_000)
        liveness.markConsumerError()

        assert.equal(liveness.isPollHealthy(60), false)
        assert.equal(liveness.secondsSincePollActivity(), 36)
    })
})
