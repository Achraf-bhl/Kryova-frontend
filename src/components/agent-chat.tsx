"use client";

import { useEffect, useRef, useState } from "react";

import { AgentStepList } from "@/components/agent-step-list";
import { MarkdownMessage } from "@/components/markdown-message";
import { Button } from "@/components/ui/button";
import { useAgentChat } from "@/hooks/use-agent-chat";

const DEFAULT_EXAMPLES = [
  "What projects do I have?",
  "How did the last run go?",
  "Which material has the highest yield strength?",
];

export interface AgentChatProps {
  projectId?: string;
  title?: string;
  subtitle?: string;
  placeholder?: string;
  examples?: string[];
  defaultAllowMutations?: boolean;
  autoFocus?: boolean;
  onProjectCreated?: (projectId: string) => void;
}

export function AgentChat({
  projectId,
  title = "Assistant",
  subtitle = "Ask about your parts, results, or what to change.",
  placeholder = "Ask about your parts or results…",
  examples = DEFAULT_EXAMPLES,
  defaultAllowMutations = false,
  autoFocus = false,
  onProjectCreated,
}: AgentChatProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    turns, busy, error, allowMutations, setAllowMutations,
    liveSteps, thinking, narration, send, stop,
  } = useAgentChat({ projectId, defaultAllowMutations, onProjectCreated });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, liveSteps, narration]);

  const submit = () => {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    void send(message);
  };

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-surface shadow-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-accent">{title}</h2>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
          <input
            id="allow-mutations"
            type="checkbox"
            checked={allowMutations}
            onChange={(e) => setAllowMutations(e.target.checked)}
            className="accent-primary"
          />
          <span>Allow it to run analyses</span>
        </label>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && !busy && (
          <div className="space-y-2 py-6 text-center">
            <p className="text-sm text-muted">Try one of these:</p>
            {examples.map((example) => (
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

        {turns.map((turn) => (
          <div key={turn.id} className="space-y-2">
            {turn.role === "user" ? (
              <p className="ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-primary px-3 py-2 text-sm text-white">
                {turn.content}
              </p>
            ) : (
              <>
                {turn.steps && turn.steps.length > 0 && <AgentStepList steps={turn.steps} />}
                <div className="max-w-[95%]">
                  <MarkdownMessage content={turn.content} />
                </div>
                {turn.truncated && (
                  <p className="text-xs text-danger">
                    The assistant ran out of steps for that turn — try narrowing the question.
                  </p>
                )}
              </>
            )}
          </div>
        ))}

        {(liveSteps.length > 0 || thinking) && <AgentStepList steps={liveSteps} thinking={thinking} />}
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
            aria-label={placeholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            disabled={busy}
            autoFocus={autoFocus}
            className="flex-1 rounded-md border border-border bg-transparent px-3 py-2 text-sm text-accent outline-none placeholder:text-muted focus:border-primary disabled:opacity-60"
          />
          {busy ? (
            <Button type="button" variant="secondary" onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button type="button" onClick={submit} disabled={!input.trim()}>
              Send
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
