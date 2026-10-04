"use client";

import { useState } from "react";

import { Button } from "@/components/ui";
import type { NextAction } from "@/lib/agent-stream";

/** How many open tasks are named before the rest are counted. */
const TASKS_SHOWN = 4;

/**
 * The one thing a stopped turn can do next, as a button (ROAD_TO_10 2.2).
 *
 * **What it replaces.** A turn that ran out of tool rounds ended with a banner
 * telling the user to ask for one thing at a time. What people typed was "go
 * on", which the model read as a new request — sometimes starting the design
 * over. Pressing this sends no words at all: the backend writes the
 * continuation (naming the first open task of the plan the model declared) and
 * stores it marked as one, so the transcript records an act and not prose in
 * the user's voice.
 *
 * Unlike `InterventionPrompt` this *is* styled as the primary action, and that
 * is not a contradiction of that component's first rule. A decision has several
 * defensible answers and nudging toward one is the product deciding; Continue is
 * not a decision, it is the single thing the stopped turn can do, and a second
 * styling would suggest a choice that does not exist. The reason a turn stopped
 * is still printed beside it, so a repeated-call stop does not read as a plain
 * "keep going".
 *
 * `detail` is rendered, always, for the reason `InterventionChoice.detail` is: a
 * button whose consequence the reader cannot see is the failure this surface
 * exists to avoid.
 */
export function ContinuePrompt({
  action,
  onContinue,
  disabled = false,
}: {
  action: NextAction;
  /** Sends the server-defined continuation. The parent owns the conversation. */
  onContinue: () => void;
  disabled?: boolean;
}) {
  // Latched after the first press. Between the press and the stream's first
  // event there is a gap in which `busy` is not yet true, and a second press in
  // it would send the continuation twice.
  const [pressed, setPressed] = useState(false);

  const shown = action.open_tasks.slice(0, TASKS_SHOWN);
  const hidden = action.open_tasks.length - shown.length;

  return (
    <section
      // A labelled region rather than an alert: this sits under a finished
      // answer that the user is still reading.
      aria-label="Continue where this stopped"
      className="mt-3 rounded-lg border border-border bg-surface px-4 py-3"
    >
      <p className="text-sm text-muted">{action.detail}</p>

      {shown.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-sm text-accent">
          {shown.map((task) => (
            <li key={task.id} className="flex items-baseline gap-2">
              <span className="font-mono text-xs text-muted">{task.id}</span>
              <span>{task.title}</span>
            </li>
          ))}
          {hidden > 0 && <li className="text-xs text-muted">and {hidden} more</li>}
        </ul>
      )}

      <div className="mt-3">
        <Button
          variant="primary"
          disabled={disabled || pressed}
          onClick={() => {
            setPressed(true);
            onContinue();
          }}
        >
          {pressed ? "Continuing…" : action.label}
        </Button>
      </div>
    </section>
  );
}
