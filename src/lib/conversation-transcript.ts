import type { StepView } from "@/components/agent-step-list";
import type { NextAction } from "@/lib/agent-stream";
import type { ConversationMessage } from "@/types/conversation";

/**
 * One exchange in the thread, as the UI renders it.
 *
 * `id` exists so React has a stable key. Array indices were the key before, and
 * they are wrong here for a concrete reason: turns are appended while a stream
 * is running and steps are folded into an existing turn afterwards, so an
 * index key makes React reconcile a growing list against the wrong nodes.
 */
export interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
  /**
   * The stored message this turn was drawn from. Absent on a turn that arrived live
   * and has not been reloaded: the stream does not report sequence numbers, and the
   * UI must not guess one.
   */
  sequence?: number;
  /** An answer a branch may start at (2.5), as the server marked it. */
  branchable?: boolean;
  steps?: StepView[];
  /**
   * A user turn the *server* wrote because Continue was pressed (2.2). Drawn as
   * a divider, not a bubble: it is not what the person typed, and putting
   * "[kryova] continue from the first open task…" in their voice would be the
   * product speaking and signing the user's name to it.
   */
  continuation?: boolean;
  truncated?: boolean;
  /** Why an unfinished turn stopped — see `AgentEvent`'s `done` event. */
  stopReason?:
    | "step_budget"
    | "repeated_calls"
    | "cancelled"
    | "needs_input"
    | "awaiting_approval"
    | "task_boundary"
    | "provider_busy";
  /**
   * What one press of Continue can do, while this is the newest turn (2.2).
   * Cleared the moment anything follows it: a Continue under an answer that has
   * since been continued would resume work that is already running.
   */
  nextAction?: NextAction;
  /**
   * A decision Kryova is waiting on, rendered in the thread rather than left as
   * the last paragraph of the answer (2026-09-22).
   *
   * **Live-turn only, and that is deliberate rather than an omission.** The
   * backend appends the same question to the assistant message, so a rebuilt
   * transcript still carries it in `content` — the prose is the record and this
   * is the surface. A reload past the ten-minute resume buffer therefore loses
   * the buttons and never the question.
   */
  intervention?: import("@/lib/agent-stream").Intervention;
  /** Set when the turn ended in an error, so the UI can offer a retry. */
  error?: string;
}

function stepFrom(message: ConversationMessage): StepView {
  return {
    id: message.tool_call_id ?? `seq-${message.sequence}`,
    tool: message.tool_name ?? "tool",
    label: message.label ?? message.tool_name ?? "Tool call",
    arguments: message.arguments ?? {},
    status: message.is_error ? "error" : "ok",
    summary: message.summary ?? undefined,
    durationMs: message.duration_ms ?? undefined,
    result: message.result,
  };
}

/**
 * Rebuild the visible thread from a stored transcript.
 *
 * The wire format is not the display format. The backend stores one row per
 * message, and a single answer is spread over three kinds of row: the assistant
 * turn that requested tools (no text), one row per tool result, then the
 * assistant turn that finally speaks. This folds those back into user/assistant
 * turns with their steps attached — and attaches each run of steps to the turn
 * that *follows* it, which is the turn that produced them.
 *
 * Steps that never got an answer (a run that errored, or one still unfinished
 * when the page was closed) are kept on a trailing turn rather than dropped:
 * losing the record of what the agent did to a CATIA document would be worse
 * than showing an answerless turn.
 */
export function conversationToTurns(
  messages: readonly ConversationMessage[],
  nextAction?: NextAction | null,
): Turn[] {
  const turns: Turn[] = [];
  let pendingSteps: StepView[] = [];

  const ordered = [...messages].sort((a, b) => a.sequence - b.sequence);

  for (const message of ordered) {
    if (message.role === "tool") {
      pendingSteps.push(stepFrom(message));
      continue;
    }

    const content = message.content?.trim() ?? "";

    if (message.role === "user") {
      if (content === "") continue;
      if (message.continuation) {
        // The stored text is the model's instruction; the reader sees the act.
        turns.push({
          id: `m-${message.sequence}`,
          sequence: message.sequence,
          role: "user",
          content: "Continued",
          continuation: true,
        });
        continue;
      }
      turns.push({
        id: `m-${message.sequence}`,
        sequence: message.sequence,
        role: "user",
        content,
      });
      continue;
    }

    // An assistant row with no text is the tool-call request itself. Its results
    // arrive as the `tool` rows below it, so there is nothing to render yet.
    if (content === "") continue;

    turns.push({
      id: `m-${message.sequence}`,
      sequence: message.sequence,
      role: "assistant",
      content,
      ...(message.branchable ? { branchable: true } : {}),
      ...(pendingSteps.length > 0 ? { steps: pendingSteps } : {}),
    });
    pendingSteps = [];
  }

  if (pendingSteps.length > 0) {
    turns.push({ id: "trailing-steps", role: "assistant", content: "", steps: pendingSteps });
  }

  // Only the newest turn can be continued, and only when it is the assistant's:
  // a stored `next_action` followed by a user message is already stale, and the
  // server does not send one then, but a stale payload must not draw a button.
  const last = turns[turns.length - 1];
  if (nextAction && last?.role === "assistant") {
    last.nextAction = nextAction;
  }

  return turns;
}

/**
 * The newest turn the person *wrote*: a typed message, not the divider Continue
 * leaves. This is the turn Retry and Edit act on, and it is the same message the
 * server's rewind deletes from — the two must agree, or Retry removes one thing
 * on screen and another in the record.
 */
export function lastTypedIndex(turns: readonly Turn[]): number {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.role === "user" && !turn.continuation) return index;
  }
  return -1;
}

/** What is left after the server's rewind: everything before the newest typed message. */
export function dropLastExchange(turns: readonly Turn[]): Turn[] {
  const index = lastTypedIndex(turns);
  return index < 0 ? [...turns] : turns.slice(0, index);
}

/**
 * Where a Branch under `turns[index]` would start, or null when the server would
 * refuse one there (2.5).
 *
 * `fromSequence` is `undefined` for the newest answer of a conversation still on
 * screen from a live stream — it has no sequence the UI knows, and the server's
 * default is exactly "the newest answer". For any other turn without a sequence
 * there is no honest answer, so no button.
 */
export interface BranchPoint {
  fromSequence: number | undefined;
}

export function branchPointAt(
  turns: readonly Turn[],
  index: number,
  busy: boolean,
): BranchPoint | null {
  const turn = turns[index];
  if (!turn || turn.role !== "assistant" || !turn.content || turn.error) return null;
  if (turn.sequence !== undefined) {
    return turn.branchable ? { fromSequence: turn.sequence } : null;
  }
  return !busy && index === turns.length - 1 ? { fromSequence: undefined } : null;
}

/**
 * The answer a person can branch from instead of retrying `turns[index]` — the
 * nearest earlier one the server will start at. Offered when a rewind is refused
 * because the turn changed the part: the refusal says to branch from before it,
 * and this is what makes that one click.
 */
export function branchPointBefore(turns: readonly Turn[], index: number): BranchPoint | null {
  for (let at = index - 1; at >= 0; at -= 1) {
    const turn = turns[at];
    if (turn.role === "assistant" && turn.branchable && turn.sequence !== undefined) {
      return { fromSequence: turn.sequence };
    }
  }
  return null;
}
