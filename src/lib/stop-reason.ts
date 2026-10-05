/**
 * Why a turn stopped, in one sentence, and how loudly to say it (ROAD_TO_10 8.4).
 *
 * This was a six-deep ternary inside `chat-view.tsx`; the wording is the product's
 * promise about what to do next, so it is a function with a test per ending. The
 * button that goes with an ending is *not* chosen here: `Continue` comes from the
 * server's `next_action` (never from the reason), and the decision prompt from the
 * server's `intervention`. What this adds is the sentence, the tone, and the one
 * ending whose remedy is a place rather than a button — the approvals queue.
 */

export type StopReason =
  | "finished"
  | "step_budget"
  | "repeated_calls"
  | "cancelled"
  | "needs_input"
  | "awaiting_approval"
  | "task_boundary"
  | "provider_busy";

export type StopTone = "muted" | "warning";

export interface StopExplanation {
  text: string;
  /**
   * A user stopping, a checkpoint doing its job, the agent pacing itself and somebody
   * else's queue are not faults and are not amber. A repeated refusal or running out
   * of rounds is, because something did go wrong on the way.
   */
  tone: StopTone;
  /** Where to go when the remedy is a page, not a button. */
  link?: { href: string; label: string };
}

export interface StopContext {
  /** The server attached a decision prompt (`intervention`) under the answer. */
  hasIntervention: boolean;
  /** The server attached a Continue button (`next_action`). */
  hasNextAction: boolean;
}

export const APPROVALS_HREF = "/dashboard/approvals";

export function explainStop(reason: string | undefined, context: StopContext): StopExplanation {
  switch (reason) {
    case "cancelled":
      return {
        tone: "muted",
        text: "You stopped this turn. Everything above really ran — say what to do next and it carries on from there.",
      };
    case "repeated_calls":
      return {
        tone: "warning",
        text: "The agent stopped because it kept repeating a call that had already been refused. Tell it what to do differently — it keeps everything it built.",
      };
    case "needs_input":
      return {
        tone: "warning",
        // With a prompt below, "the end of its answer" would point past the thing to answer.
        text: context.hasIntervention
          ? "The agent stopped to ask you something rather than keep retrying. Answer below and it carries on from what is built."
          : "The agent stopped to ask you something rather than keep retrying — the question is at the end of its answer. Answer it and it carries on from what is built.",
      };
    case "awaiting_approval":
      return {
        tone: "muted",
        text: context.hasIntervention
          ? "The agent reached a checkpoint that needs sign-off. Nothing past it has run — decide below, or open it under Approvals."
          : "The agent reached a checkpoint that needs sign-off. Nothing past it has run; approve or reject it under Approvals and it carries on from there.",
        link: { href: APPROVALS_HREF, label: "Open Approvals" },
      };
    case "task_boundary":
      return {
        tone: "muted",
        text: "The agent stopped at the end of a task because the rest of the plan would not fit in this turn's tool rounds. Everything above ran — press Continue to start the next task.",
      };
    case "provider_busy":
      return {
        tone: "muted",
        text: "The model provider stayed too busy to answer after several tries. Nothing was lost — press Continue to try again.",
      };
    default:
      // `step_budget`, or a backend that predates the field. "Continue" is promised only when
      // the server sent the button; otherwise the older advice is the true one.
      return {
        tone: "warning",
        text: context.hasNextAction
          ? "The agent used all of its tool rounds for that turn. Everything above ran — press Continue to carry on from what is built."
          : "The agent ran out of tool rounds for that turn. Ask for one thing at a time and it will get further.",
      };
  }
}
