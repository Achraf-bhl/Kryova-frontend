"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AgentStepList, type StepView } from "@/components/agent-step-list";
import { Button } from "@/components/ui/button";
import { streamAgent, type AgentEvent } from "@/lib/agent-stream";

interface Turn {
  role: "user" | "assistant";
  content: string;
  /** Tool calls made while producing this turn. Assistant turns only. */
  steps?: StepView[];
  truncated?: boolean;
}

export function AgentChat({ projectId }: { projectId?: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowMutations, setAllowMutations] = useState(false);

  // Live state for the turn in flight, kept separate from committed turns so a
  // failure mid-stream cannot corrupt the transcript above it.
  const [liveSteps, setLiveSteps] = useState<StepView[]>([]);
  const [thinking, setThinking] = useState<{ step: number; maxSteps: number } | null>(null);
  const [narration, setNarration] = useState("");

  const conversationId = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, liveSteps, narration]);

  // Abort an in-flight stream if the component goes away, so a navigation
  // does not leave the request running with nowhere to deliver.
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case "start":
        conversationId.current = event.conversation_id;
        break;
      case "thinking":
        setThinking({ step: event.step, maxSteps: event.max_steps });
        break;
      case "narration":
        setNarration(event.content);
        break;
      case "tool_start":
        setThinking(null);
        setLiveSteps((prev) => [
          ...prev,
          {
            id: event.id,
            tool: event.tool,
            label: event.label,
            arguments: event.arguments,
            status: "running",
          },
        ]);
        break;
      case "tool_end":
        setLiveSteps((prev) =>
          prev.map((step) =>
            step.id === event.id
              ? {
                  ...step,
                  status: event.ok ? "ok" : "error",
                  summary: event.summary,
                  durationMs: event.duration_ms,
                  result: event.result,
                }
              : step,
          ),
        );
        break;
      case "message":
        setTurns((prev) => [...prev, { role: "assistant", content: event.content }]);
        break;
      case "done":
        conversationId.current = event.conversation_id;
        // Attach the steps to the assistant turn that was just pushed, so the
        // work stays visible in the transcript instead of vanishing.
        setLiveSteps((steps) => {
          setTurns((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].role === "assistant") {
                next[i] = { ...next[i], steps, truncated: event.truncated };
                break;
              }
            }
            return next;
          });
          return [];
        });
        setThinking(null);
        setNarration("");
        break;
      case "error":
        setError(event.message);
        break;
    }
  }, []);

  async function send() {
    const message = input.trim();
    if (!message || busy) return;

    setInput("");
    setError(null);
    setTurns((prev) => [...prev, { role: "user", content: message }]);
    setLiveSteps([]);
    setBusy(true);

    abortRef.current = new AbortController();
    try {
      await streamAgent(
        {
          message,
          conversation_id: conversationId.current,
          project_id: projectId ?? null,
          allow_mutations: allowMutations,
        },
        handleEvent,
        abortRef.current.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "The assistant is unavailable.");
      }
    } finally {
      setBusy(false);
      setThinking(null);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-surface shadow-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-accent">Assistant</h2>
          <p className="text-xs text-muted">
            Ask about your parts, results, or what to change.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={allowMutations}
            onChange={(e) => setAllowMutations(e.target.checked)}
            className="accent-primary"
          />
          {/* Off by default: this unlocks tools that cost real compute. */}
          Allow it to run analyses
        </label>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && !busy && (
          <div className="space-y-2 py-6 text-center">
            <p className="text-sm text-muted">Try one of these:</p>
            {[
              "What projects do I have?",
              "How did the last run go?",
              "Which material has the highest yield strength?",
            ].map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setInput(example)}
                className="mx-auto block rounded-full border border-border px-3 py-1 text-xs text-muted transition hover:border-primary hover:text-primary"
              >
                {example}
              </button>
            ))}
          </div>
        )}

        {turns.map((turn, index) => (
          <div key={index} className="space-y-2">
            {turn.role === "user" ? (
              <p className="ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-primary px-3 py-2 text-sm text-white">
                {turn.content}
              </p>
            ) : (
              <>
                {turn.steps && turn.steps.length > 0 && (
                  <AgentStepList steps={turn.steps} />
                )}
                <p className="max-w-[95%] whitespace-pre-wrap text-sm text-accent">
                  {turn.content}
                </p>
                {turn.truncated && (
                  <p className="text-xs text-danger">
                    The assistant ran out of steps for that turn — try narrowing the question.
                  </p>
                )}
              </>
            )}
          </div>
        ))}

        {(liveSteps.length > 0 || thinking) && (
          <AgentStepList steps={liveSteps} thinking={thinking} />
        )}
        {narration && <p className="text-sm italic text-muted">{narration}</p>}
        {error && (
          <p className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      <footer className="border-t border-border p-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Ask about your parts or results…"
            disabled={busy}
            className="flex-1 rounded-md border border-border bg-transparent px-3 py-2 text-sm text-accent outline-none placeholder:text-muted focus:border-primary disabled:opacity-60"
          />
          {busy ? (
            <Button type="button" variant="secondary" onClick={() => abortRef.current?.abort()}>
              Stop
            </Button>
          ) : (
            <Button type="button" onClick={() => void send()} disabled={!input.trim()}>
              Send
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
