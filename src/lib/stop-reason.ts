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

import { translate, type MessageKey } from "@/lib/i18n/catalogue";

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

type Say = (key: MessageKey) => string;
const english: Say = (key) => translate("en", key);

/**
 * `say` is the interface's translator (`useT()`); the default is English so the function is
 * usable, and testable, with no provider. The *choice* of sentence is not language-dependent
 * and is what the tests pin.
 */
export function explainStop(
  reason: string | undefined,
  context: StopContext,
  say: Say = english,
): StopExplanation {
  switch (reason) {
    case "cancelled":
      return { tone: "muted", text: say("stop.cancelled") };
    case "repeated_calls":
      return { tone: "warning", text: say("stop.repeated_calls") };
    case "needs_input":
      return {
        tone: "warning",
        // With a prompt below, "the end of its answer" would point past the thing to answer.
        text: say(context.hasIntervention ? "stop.needs_input.prompt" : "stop.needs_input.prose"),
      };
    case "awaiting_approval":
      return {
        tone: "muted",
        text: say(
          context.hasIntervention ? "stop.awaiting_approval.prompt" : "stop.awaiting_approval.prose",
        ),
        link: { href: APPROVALS_HREF, label: say("stop.awaiting_approval.link") },
      };
    case "task_boundary":
      return { tone: "muted", text: say("stop.task_boundary") };
    case "provider_busy":
      return { tone: "muted", text: say("stop.provider_busy") };
    default:
      // `step_budget`, or a backend that predates the field. "Continue" is promised only when
      // the server sent the button; otherwise the older advice is the true one.
      return {
        tone: "warning",
        text: say(context.hasNextAction ? "stop.step_budget.continue" : "stop.step_budget.plain"),
      };
  }
}
