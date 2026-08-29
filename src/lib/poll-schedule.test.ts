import { describe, expect, it } from "vitest";

import {
  POLL_ERROR_LIMIT,
  POLL_GIVE_UP_MS,
  POLL_MAX_MS,
  POLL_MIN_MS,
  initialPollState,
  nextAfterError,
  nextAfterSuccess,
  type PollScheduleState,
} from "./poll-schedule";

/** Drive the machine through `count` non-terminal successes at t=0. */
function runSuccesses(count: number): { state: PollScheduleState; delays: number[] } {
  let state = initialPollState();
  const delays: number[] = [];
  for (let i = 0; i < count; i++) {
    const step = nextAfterSuccess(state, false, 0);
    state = step.state;
    if (step.decision.action === "wait") delays.push(step.decision.delayMs);
  }
  return { state, delays };
}

describe("poll schedule — success path", () => {
  it("stops as soon as the job reaches a terminal status", () => {
    const { decision } = nextAfterSuccess(initialPollState(), true, 0);
    expect(decision).toEqual({ action: "stop" });
  });

  it("backs off from the floor towards the ceiling", () => {
    const { delays } = runSuccesses(5);
    expect(delays[0]).toBeGreaterThan(POLL_MIN_MS);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });

  it("never exceeds the ceiling however long the job runs", () => {
    const { delays } = runSuccesses(50);
    for (const delay of delays) expect(delay).toBeLessThanOrEqual(POLL_MAX_MS);
    expect(delays.at(-1)).toBe(POLL_MAX_MS);
  });

  it("gives up on wall time, not on poll count", () => {
    // A job stuck in RUNNING used to poll forever; the backoff only stretched
    // the interval, it never ended the loop.
    const step = nextAfterSuccess(initialPollState(), false, POLL_GIVE_UP_MS + 1);
    expect(step.decision).toEqual({ action: "give-up", reason: "timeout" });
  });

  it("keeps polling right up to the deadline", () => {
    const step = nextAfterSuccess(initialPollState(), false, POLL_GIVE_UP_MS - 1);
    expect(step.decision.action).toBe("wait");
  });

  it("still reports a finished job that crossed the deadline", () => {
    // Terminal wins over the timeout: a result that arrived is a result.
    const step = nextAfterSuccess(initialPollState(), true, POLL_GIVE_UP_MS * 2);
    expect(step.decision).toEqual({ action: "stop" });
  });
});

describe("poll schedule — error path", () => {
  it("retries a transient failure instead of giving up immediately", () => {
    const step = nextAfterError(initialPollState(), 0);
    expect(step.decision).toEqual({ action: "wait", delayMs: POLL_MIN_MS });
    expect(step.state.consecutiveErrors).toBe(1);
  });

  it("doubles the retry delay per consecutive failure", () => {
    let state = initialPollState();
    const delays: number[] = [];
    for (let i = 0; i < POLL_ERROR_LIMIT - 1; i++) {
      const step = nextAfterError(state, 0);
      state = step.state;
      if (step.decision.action === "wait") delays.push(step.decision.delayMs);
    }
    expect(delays).toEqual([POLL_MIN_MS, POLL_MIN_MS * 2]);
  });

  it("surfaces the failure after the strike limit", () => {
    let state = initialPollState();
    let last = nextAfterError(state, 0);
    for (let i = 1; i < POLL_ERROR_LIMIT; i++) {
      state = last.state;
      last = nextAfterError(state, 0);
    }
    expect(last.decision).toEqual({ action: "fail" });
  });

  it("clears the strike count on the next success", () => {
    const failed = nextAfterError(initialPollState(), 0);
    expect(failed.state.consecutiveErrors).toBe(1);
    const recovered = nextAfterSuccess(failed.state, false, 0);
    expect(recovered.state.consecutiveErrors).toBe(0);
  });

  it("does not let a recovered blip inherit an error retry delay", () => {
    // Two blips then a success must resume the success-path interval, not the
    // 6s error backoff — the job is healthy again.
    const first = nextAfterError(initialPollState(), 0);
    const second = nextAfterError(first.state, 0);
    const recovered = nextAfterSuccess(second.state, false, 0);
    expect(recovered.decision).toEqual({
      action: "wait",
      delayMs: recovered.state.intervalMs,
    });
    expect(recovered.state.intervalMs).toBeLessThanOrEqual(POLL_MAX_MS);
  });
});
