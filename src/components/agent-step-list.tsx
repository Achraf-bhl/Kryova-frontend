"use client";

import { useState } from "react";

export interface StepView {
  id: string;
  tool: string;
  label: string;
  arguments: Record<string, unknown>;
  status: "running" | "ok" | "error";
  summary?: string;
  durationMs?: number;
  result?: unknown;
}

/** A single tool call, expandable to its raw arguments and result.
 *
 * Collapsed by default: the summary is what a user needs, and the payload is
 * there for when they want to check the agent's work rather than trust it.
 */
function Step({ step }: { step: StepView }) {
  const [open, setOpen] = useState(false);
  const dot =
    step.status === "running"
      ? "bg-primary animate-pulse"
      : step.status === "ok"
        ? "bg-success"
        : "bg-danger";

  return (
    <li className="relative pl-6">
      {/* Timeline rail. The dot sits on it; the line joins it to the next step. */}
      <span
        className="absolute left-0.75 top-4 h-full w-px bg-border last:hidden"
        aria-hidden
      />
      <span className={`absolute left-0 top-1.5 h-1.75 w-1.75 rounded-full ${dot}`} aria-hidden />

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-baseline gap-2 py-1 text-left"
        aria-expanded={open}
      >
        <span className="text-sm text-accent">{step.label}</span>
        {step.summary && (
          <span className="truncate text-xs text-muted">— {step.summary}</span>
        )}
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted">
          {step.status === "running"
            ? "running…"
            : step.durationMs !== undefined
              ? `${step.durationMs} ms`
              : ""}
        </span>
      </button>

      {open && (
        <div className="mb-2 space-y-2 rounded-md border border-border bg-muted/10 p-2">
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">
              {step.tool}
            </p>
            <pre className="overflow-x-auto text-[11px] leading-relaxed text-muted">
              {JSON.stringify(step.arguments, null, 2)}
            </pre>
          </div>
          {step.result !== undefined && (
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-muted">
                Result
              </p>
              <pre className="max-h-52 overflow-auto text-[11px] leading-relaxed text-muted">
                {JSON.stringify(step.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** The agent's work for one turn, rendered as it happens. */
export function AgentStepList({
  steps,
  thinking,
}: {
  steps: StepView[];
  thinking?: { step: number; maxSteps: number } | null;
}) {
  if (steps.length === 0 && !thinking) return null;

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          What the assistant is doing
        </p>
        {thinking && (
          <p className="text-[11px] tabular-nums text-muted">
            step {thinking.step}/{thinking.maxSteps}
          </p>
        )}
      </div>

      <ol className="space-y-0.5">
        {steps.map((step) => (
          <Step key={step.id} step={step} />
        ))}
      </ol>

      {thinking && (
        <p className="mt-2 flex items-center gap-2 pl-6 text-sm text-muted">
          <span className="inline-flex gap-1" aria-hidden>
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                className="h-1 w-1 animate-bounce rounded-full bg-muted"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </span>
          Thinking
        </p>
      )}
    </div>
  );
}
