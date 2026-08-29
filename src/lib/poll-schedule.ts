/**
 * The polling cadence for an asynchronous solve job, as a pure state machine.
 *
 * A simulation is `POST`ed, returns 202, and the results page polls until it
 * reaches a terminal status. Getting that cadence right is the difference
 * between a page that feels instant on a two-second job and one that hammers
 * the API for the half hour a 400k-element mesh takes. It also has to survive
 * the API going away mid-run without either giving up on the first blip or
 * spinning forever.
 *
 * Kept free of timers and React so it can be tested by driving it directly.
 */

/** First interval after a successful poll of a still-running job. */
export const POLL_MIN_MS = 1_500;
/** Ceiling the success-path interval backs off to. */
export const POLL_MAX_MS = 15_000;
/** Growth applied to the success-path interval on each non-terminal poll. */
export const POLL_GROWTH = 1.35;
/** Total wall time after which polling stops and the page offers a retry. */
export const POLL_GIVE_UP_MS = 30 * 60 * 1_000;
/** Consecutive failures tolerated before the error is surfaced to the user. */
export const POLL_ERROR_LIMIT = 3;

export type PollDecision =
  | { action: "stop" }
  | { action: "wait"; delayMs: number }
  | { action: "give-up"; reason: "timeout" }
  | { action: "fail" };

export interface PollScheduleState {
  /** Interval the next successful non-terminal poll will wait. */
  intervalMs: number;
  /** Failures since the last success. */
  consecutiveErrors: number;
  /** Total elapsed ms, as reported by the caller's clock. */
  elapsedMs: number;
}

export function initialPollState(): PollScheduleState {
  return { intervalMs: POLL_MIN_MS, consecutiveErrors: 0, elapsedMs: 0 };
}

/**
 * Decide what to do after a poll that came back with `status`.
 *
 * `elapsedMs` is measured from the first poll, not from the last one, so a job
 * that is genuinely stuck is abandoned on wall time rather than on a poll count
 * that the backoff keeps stretching.
 */
export function nextAfterSuccess(
  state: PollScheduleState,
  terminal: boolean,
  elapsedMs: number,
): { state: PollScheduleState; decision: PollDecision } {
  const cleared: PollScheduleState = { ...state, consecutiveErrors: 0, elapsedMs };
  if (terminal) return { state: cleared, decision: { action: "stop" } };
  if (elapsedMs > POLL_GIVE_UP_MS) {
    return { state: cleared, decision: { action: "give-up", reason: "timeout" } };
  }
  const intervalMs = Math.min(cleared.intervalMs * POLL_GROWTH, POLL_MAX_MS);
  return { state: { ...cleared, intervalMs }, decision: { action: "wait", delayMs: intervalMs } };
}

/**
 * Decide what to do after a poll that threw.
 *
 * Retries use their own exponential delay rather than the success-path
 * interval: a transient 502 should be retried quickly, and a backoff that has
 * already stretched to 15s would make a blip look like a hang.
 */
export function nextAfterError(
  state: PollScheduleState,
  elapsedMs: number,
): { state: PollScheduleState; decision: PollDecision } {
  const consecutiveErrors = state.consecutiveErrors + 1;
  const next: PollScheduleState = { ...state, consecutiveErrors, elapsedMs };
  if (consecutiveErrors >= POLL_ERROR_LIMIT) {
    return { state: next, decision: { action: "fail" } };
  }
  return {
    state: next,
    decision: { action: "wait", delayMs: POLL_MIN_MS * 2 ** (consecutiveErrors - 1) },
  };
}
