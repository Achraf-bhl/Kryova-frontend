/** Client for the agent's Server-Sent Events stream.
 *
 * Hand-rolled rather than using `EventSource`: that API is GET-only and cannot
 * send the CSRF header the backend requires on a mutation, so this reads the
 * `fetch` body with a streaming reader instead. Same wire format either way.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export type AgentEvent =
  | { type: "start"; conversation_id: string }
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
      steps: number;
    }
  | { type: "error"; message: string };

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

/** Stream one agent turn, invoking `onEvent` as each event arrives. */
export async function streamAgent(
  payload: ChatRequest,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers = new Headers({
    "content-type": "application/json",
    "x-requested-with": "kryova",
  });
  const token = csrfToken();
  if (token) headers.set("x-csrf-token", decodeURIComponent(token));

  const response = await fetch(`${BASE_URL}/ai/chat/stream`, {
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

  const reader = response.body.getReader();
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
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as AgentEvent);
      } catch {
        // A malformed frame should not kill a run that is otherwise working.
      }
    }
  }
}
