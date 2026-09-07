"use client";

import { useMemo, useState } from "react";

import { ToolImage } from "@/components/tool-image";
import { toolImageFrom } from "@/lib/tool-media";

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

/**
 * Where the agent's loop is, for as long as a turn is running.
 *
 * Non-null means "a turn is in flight"; it is *not* cleared while a tool runs,
 * which is what used to make the panel's counter blink out for the whole
 * duration of every call — absent exactly when the user most wants it.
 *
 * `round`/`maxRounds` are the loop's own budget and are deliberately **not**
 * rendered as a fraction. They count model round-trips, which is a different
 * quantity from the steps listed below them: one round can run several tools,
 * and a self-correction round runs none. `maxRounds` (20) is a backstop that a
 * normal turn never approaches, so "3/20" read as progress said 15% about a
 * turn that was one round from finishing. A cap displayed as progress is the
 * dishonest-number case this codebase refuses elsewhere; here the cap is shown
 * only once it is close enough to be the reason the turn will stop.
 */
export interface AgentProgress {
  /** True while the model is composing; false while its tools run. */
  composing: boolean;
  /** Loop rounds begun this turn, self-corrections included. */
  round: number;
  /** The backstop the loop stops at. */
  maxRounds: number;
}

/** How few rounds must remain before the ceiling is worth naming at all. */
export const ROUNDS_LEFT_NOTICE = 3;

/**
 * Rounds left before the turn is cut off, or `null` while that is not news.
 *
 * `maxRounds <= 0` is also `null`: a budget nobody sent is not a budget of
 * zero, and reporting "0 rounds left" on a healthy turn would be a fabrication.
 */
export function roundsLeft(progress: AgentProgress | null | undefined): number | null {
  if (!progress || progress.maxRounds <= 0) return null;
  const left = progress.maxRounds - progress.round;
  return left <= ROUNDS_LEFT_NOTICE ? Math.max(left, 0) : null;
}

function pluralSteps(count: number): string {
  return count === 1 ? "1 step" : `${count} steps`;
}

/**
 * The counter over the step list, derived from the list itself.
 *
 * Deriving it is the point: a number computed from the rows on screen cannot
 * contradict them, which the loop's round number could and did — "step 3/20"
 * sat above five completed steps because they are two different meanings of
 * the word. It only ever grows within a turn, so it does not flicker.
 */
export function stepCountLabel(steps: StepView[]): string | null {
  if (steps.length === 0) return null;
  return steps.some((step) => step.status === "running")
    ? `step ${steps.length}`
    : pluralSteps(steps.length);
}

/** The ceiling, worded identically wherever it is shown or announced. */
export function ceilingLabel(progress: AgentProgress | null | undefined): string | null {
  const left = roundsLeft(progress);
  if (left === null) return null;
  return left === 1 ? "1 tool round left" : `${left} tool rounds left`;
}

/**
 * What a screen reader hears while the agent works.
 *
 * Built from the same two inputs the panel renders, so the announcement and
 * the visible text cannot drift apart or name different numbers.
 */
export function activityLabel(
  steps: StepView[],
  progress: AgentProgress | null | undefined,
): string {
  const ceiling = ceilingLabel(progress);
  const suffix = ceiling ? `, ${ceiling}` : "";
  const running = steps.find((step) => step.status === "running");
  if (running) return `Running step ${steps.length}, ${running.label}${suffix}`;
  if (progress?.composing) {
    return steps.length > 0
      ? `Thinking, ${pluralSteps(steps.length)} done${suffix}`
      : `Thinking${suffix}`;
  }
  if (steps.length > 0) return `${pluralSteps(steps.length)} done${suffix}`;
  return `Working${suffix}`;
}

/** A single tool call, expandable to its raw arguments and result.
 *
 * Collapsed by default: the summary is what a user needs, and the payload is
 * there for when they want to check the agent's work rather than trust it.
 */
function Step({ step }: { step: StepView }) {
  const [open, setOpen] = useState(false);
  // A picture the step produced, shown in the row rather than behind the
  // expander. See `components/tool-image.tsx` for why it is not one click deep.
  const image = useMemo(() => toolImageFrom(step.result), [step.result]);
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

      {image && <ToolImage key={image.mediaId} image={image} />}

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

/** The agent's work for one turn, rendered as it happens.
 *
 * `thinking` is the loop's state (see `AgentProgress`) and is null for a turn
 * that has finished — a settled turn still gets its counter, because the count
 * comes from the steps, not from the loop.
 */
export function AgentStepList({
  steps,
  thinking,
}: {
  steps: StepView[];
  thinking?: AgentProgress | null;
}) {
  if (steps.length === 0 && !thinking) return null;

  const counter = stepCountLabel(steps);
  const ceiling = ceilingLabel(thinking);

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          What the assistant is doing
        </p>
        <p className="flex shrink-0 items-baseline gap-2 text-[11px] tabular-nums">
          {/* The cap, and only once it is about to be the reason the turn
              stops. Before that it is not information about this turn. */}
          {ceiling && <span className="text-warning">{ceiling}</span>}
          {counter && <span className="text-muted">{counter}</span>}
        </p>
      </div>

      <ol className="space-y-0.5">
        {steps.map((step) => (
          <Step key={step.id} step={step} />
        ))}
      </ol>

      {/* The dots mean "waiting on the model", so they are gated on
          `composing` rather than on the turn being alive. While a tool runs it
          is the step's own `running…` that is telling the truth, and showing
          both said the agent was doing two things at once. */}
      {thinking?.composing && (
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
