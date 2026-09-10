/** Client for the agent's Server-Sent Events stream.
 *
 * Hand-rolled rather than using `EventSource`: that API is GET-only and cannot
 * send the CSRF header the backend requires on a mutation, so this reads the
 * `fetch` body with a streaming reader instead. Same wire format either way.
 */

import { fetchWithRefresh } from "@/lib/api-client";

export type AgentEvent =
  | { type: "start"; conversation_id: string }
  /**
   * One iteration of the agent's loop is starting — the model is being asked
   * what to do next.
   *
   * `step`/`max_steps` are **loop rounds against a backstop**, not the tool
   * steps the user sees listed. One round can run several tools (the backend
   * iterates `turn.tool_calls`), and a round can run *none* at all when the
   * model's answer has to be corrected and re-asked (`agent.py` `continue`s on
   * a tool call written as prose). So this number is neither the position in
   * the step list nor a fraction of the work to come: `max_steps` is only the
   * point at which the turn is cut off. Read it as remaining budget and
   * nothing else — see `AgentProgress` in `components/agent-step-list.tsx`.
   */
  | { type: "thinking"; step: number; max_steps: number }
  | { type: "narration"; content: string }
  | {
      type: "tool_start";
      id: string;
      tool: string;
      label: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: "tool_end";
      id: string;
      tool: string;
      ok: boolean;
      result: unknown;
      summary: string;
      duration_ms: number;
      arguments?: Record<string, unknown>;
    }
  | { type: "message"; content: string }
  | {
      type: "done";
      conversation_id: string;
      /** The conversation's project scope, set when the agent created one this turn. */
      project_id: string | null;
      truncated: boolean;
      /**
       * Why the loop stopped, when `truncated` is true. Two exits reach the
       * same closing code in `app/ai/agent.py` and until 2026-09-08 both were
       * shown as "ran out of tool rounds": `"step_budget"` really did, and
       * `"repeated_calls"` was ended early for re-issuing a call the tool
       * layer had already refused. The remedies are opposite -- ask for less
       * versus say something different -- so the banner has to tell them
       * apart. Optional: a backend that predates the field sends nothing, and
       * the old wording is the right fallback for a turn that hit the cap.
       */
      stop_reason?: "finished" | "step_budget" | "repeated_calls" | "cancelled";
      /** Tool calls actually run this turn — the length of the step list. */
      steps: number;
      prompt_tokens?: number;
      completion_tokens?: number;
    }
  /**
   * Emitted by the route (not the loop) after a turn settles, when the
   * conversation has just been titled. Nothing here consumes it yet; it is in
   * the union because it is on the wire — see `app/api/routes/ai.py`.
   */
  | { type: "title"; title: string }
  /**
   * A piece of the assistant's answer as it is being written (P5.1).
   *
   * **Not the answer.** The `message` event that follows carries the real text,
   * and a reader that concatenated these deltas instead would be maintaining a
   * second copy that drifts — on a provider that streams a corrected token, and
   * on every provider that streams nothing at all (`stream_chat`'s default
   * emits no deltas on purpose, so a non-streaming provider is not mistaken for
   * a model that wrote its answer in one go). Render these; keep `message`.
   */
  | { type: "token"; content: string }
  /**
   * The live events for this turn are no longer kept, so a resume cannot fill
   * the hole. The transcript is complete — reload the conversation. Sent by
   * `GET /ai/conversations/{id}/stream`, never by a fresh turn.
   */
  | { type: "resume_gap"; after: number; message: string }
  /** Nothing has arrived for two minutes on a resumed stream. */
  | { type: "resume_idle"; after: number; message: string }
  | { type: "error"; message: string };

/**
 * Every event carries these once it has been through the resume buffer.
 *
 * `seq` is the cursor: the last one seen is what a reconnect passes as `after`.
 * It is optional because the backend deliberately still sends the event when
 * recording it failed — losing the resume buffer costs a reader a reload, and
 * losing the turn costs them the work, so the turn wins. A missing `seq` means
 * "cannot resume from here", which is the truth rather than a guess.
 */
export interface EventCursor {
  seq?: number;
  turn_id?: string;
}

export type CursoredEvent = AgentEvent & EventCursor;

export interface ChatRequest {
  message: string;
  conversation_id?: string | null;
  project_id?: string | null;
  allow_mutations?: boolean;
}

function csrfToken(): string | null {
  if (typeof document === "undefined") return null;
  return document.cookie.match(/(?:^|;\s*)kryova_csrf=([^;]+)/)?.[1] ?? null;
}

/**
 * Stream one agent turn, invoking `onEvent` as each event arrives.
 *
 * `onEvent` receives the cursor along with the event. Hold on to the last `seq`
 * you saw: if this promise rejects with a network failure mid-turn, `resumeAgent`
 * picks the same turn back up from there rather than losing it until it ends.
 */
export async function streamAgent(
  payload: ChatRequest,
  onEvent: (event: CursoredEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers = new Headers({
    "content-type": "application/json",
    "x-requested-with": "kryova",
  });
  const token = csrfToken();
  if (token) headers.set("x-csrf-token", decodeURIComponent(token));

  // `fetchWithRefresh`, not a bare `fetch`. The access token lives 15 minutes
  // and every other transport in the app quietly renews it on a 401; this one
  // did not, so the first message sent more than 15 minutes into a session
  // failed with "Could not validate credentials" and the user was told to try
  // again — which failed identically, because nothing had renewed anything.
  //
  // Replaying the request is safe here: the body is a string, so it survives
  // being sent twice. A streaming body would not.
  const response = await fetchWithRefresh("/ai/chat/stream", {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Agent request failed with ${response.status}`);
  }
  if (!response.body) throw new Error("The agent returned no stream.");

  await readFrames(response.body, onEvent);
}

/**
 * Rejoin a turn already in flight, from the last cursor seen (P5.1).
 *
 * A `GET`, and that is what makes it a resume rather than a second turn:
 * reconnecting with a POST would start the agent again, so a client whose
 * connection dropped would double every turn it lost. This runs no agent and
 * writes no message — it replays what was recorded and then follows.
 *
 * Pass `after: 0` when there is no cursor to resume from; the backend sends
 * whatever it still holds. If the events have aged out it answers `resume_gap`
 * rather than a turn with a silent hole in the middle, and the right response
 * to that is to reload the conversation, whose transcript is complete.
 */
export async function resumeAgent(
  conversationId: string,
  after: number,
  onEvent: (event: CursoredEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetchWithRefresh(
    `/ai/conversations/${conversationId}/stream?after=${after}`,
    { headers: { "x-requested-with": "kryova" }, credentials: "include", signal },
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Could not rejoin the turn (${response.status}).`);
  }
  if (!response.body) throw new Error("The agent returned no stream.");

  await readFrames(response.body, onEvent);
}

/**
 * The SSE frame loop, shared by a fresh turn and a resumed one.
 *
 * Shared deliberately: a replayed event is byte-identical to the one that went
 * out live — the backend stores the payload exactly as it sent it — so a second
 * parser here would be a second chance for the two paths to disagree about
 * what the client saw.
 */
async function readFrames(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: CursoredEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line. A chunk can split one, so
    // keep the trailing partial in the buffer rather than parsing it.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      // `id:` lines are read from the payload's own `seq` instead: the backend
      // puts the cursor in both places, and taking it from the JSON keeps one
      // parser rather than two that can disagree about a frame.
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as CursoredEvent);
      } catch (error) {
        // A malformed frame should not kill a run that is otherwise working --
        // but it must not vanish either. Swallowed silently, a truncated or
        // non-JSON frame presents as an agent that simply skipped a step, with
        // nothing anywhere to say a message was dropped. Warn and carry on:
        // the run survives, and there is a line in the console to find.
        console.warn(
          "Dropped a malformed agent stream frame",
          { frame: line.slice(0, 400) },
          error,
        );
      }
    }
  }
}
