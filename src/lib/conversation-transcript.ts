import type { StepView } from "@/components/agent-step-list";
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
  steps?: StepView[];
  truncated?: boolean;
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
export function conversationToTurns(messages: readonly ConversationMessage[]): Turn[] {
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
      turns.push({ id: `m-${message.sequence}`, role: "user", content });
      continue;
    }

    // An assistant row with no text is the tool-call request itself. Its results
    // arrive as the `tool` rows below it, so there is nothing to render yet.
    if (content === "") continue;

    turns.push({
      id: `m-${message.sequence}`,
      role: "assistant",
      content,
      ...(pendingSteps.length > 0 ? { steps: pendingSteps } : {}),
    });
    pendingSteps = [];
  }

  if (pendingSteps.length > 0) {
    turns.push({ id: "trailing-steps", role: "assistant", content: "", steps: pendingSteps });
  }

  return turns;
}
