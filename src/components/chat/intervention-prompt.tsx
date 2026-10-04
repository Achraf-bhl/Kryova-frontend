"use client";

import { useState } from "react";

import type { Intervention, InterventionChoice } from "@/lib/agent-stream";
import { Button } from "@/components/ui";

/**
 * A decision Kryova is waiting on, rendered where the person already is.
 *
 * **The problem this replaces.** The agent has always known when it needed a
 * human. It said so two ways and neither put a decision in front of anybody:
 * the escalation question was appended to the end of the answer as prose, in
 * the same type as everything else, and an approval gate sent the user to a
 * different page to sign off something they could no longer see. So the
 * question was there and nobody read it.
 *
 * **Three rules this component must keep, because the backend cannot enforce
 * them from here.** Each one is a way of appearing to ask while actually
 * answering, and none of them looks wrong on screen:
 *
 * 1. **Nothing is preselected and nothing is styled as the recommendation.**
 *    Every choice is the same `secondary` button. Making one `primary` is a
 *    recommendation whether or not it is called one, and on a screen whose
 *    whole purpose is that a person decides, a nudge is the product deciding
 *    and then recording their name against it.
 * 2. **Every option prints what it will do.** `detail` is rendered under the
 *    label, always. A button whose consequence the reader cannot see is the
 *    failure this surface exists to avoid.
 * 3. **The typed answer is never taken away.** `answer_in_words` is always
 *    true, and the note points back at the composer. The choices are the
 *    common answers, not the possible ones — a list that cannot be escaped
 *    stops being a question and becomes a form, and people answer forms with
 *    the closest wrong option.
 *
 * Pressing a choice sends its own words as an ordinary message, which is why
 * this needs no new endpoint: the agent reads the answer the same way it reads
 * anything else the user types, and the conversation keeps one record of what
 * was decided. A choice that `needs_reason` opens a box first, because "no"
 * with no reason tells the agent nothing about what to do next.
 */
export function InterventionPrompt({
  intervention,
  onAnswer,
  disabled = false,
}: {
  intervention: Intervention;
  /** Sends the answer as a user message. The parent owns the conversation. */
  onAnswer: (text: string) => void;
  disabled?: boolean;
}) {
  const [reasoning, setReasoning] = useState<InterventionChoice | null>(null);
  const [reason, setReason] = useState("");
  const [answered, setAnswered] = useState(false);

  function answer(choice: InterventionChoice, words: string) {
    // The label, not the id. The transcript is read by people, and a line
    // saying "reject" is worse evidence than one saying what was rejected.
    const text = words.trim()
      ? `${choice.label} — ${words.trim()}`
      : choice.label;
    setAnswered(true);
    onAnswer(text);
  }

  function choose(choice: InterventionChoice) {
    if (choice.needs_reason) {
      setReasoning(choice);
      return;
    }
    answer(choice, "");
  }

  return (
    <section
      // `region` with a label rather than an alert: an alert interrupts a
      // screen reader mid-sentence, and this appears under a finished answer
      // the user is still reading.
      aria-label="Kryova needs you to decide"
      className="mt-3 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-warning">
        {intervention.kind === "approval"
          ? "Waiting for your sign-off"
          : "Kryova needs you to decide"}
      </p>

      <p className="mt-1.5 text-sm font-medium text-accent">{intervention.question}</p>

      <p className="mt-1 text-sm text-muted">{intervention.cause}</p>

      {intervention.quote && (
        // Verbatim, in monospace, never summarised. On this one screen the
        // exact wording is the evidence the user is deciding from.
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-surface px-3 py-2 font-mono text-xs text-muted">
          {intervention.quote}
        </pre>
      )}

      {answered ? (
        <p className="mt-3 text-sm text-muted">Sent. Kryova is carrying on from there.</p>
      ) : reasoning ? (
        <div className="mt-3">
          <label
            htmlFor="intervention-reason"
            className="block text-sm font-medium text-accent"
          >
            {reasoning.label} — why?
          </label>
          <p className="mt-0.5 text-xs text-muted">{reasoning.detail}</p>
          <textarea
            id="intervention-reason"
            autoFocus
            rows={3}
            value={reason}
            onChange={(changed) => setReason(changed.target.value)}
            className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-accent"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              // Empty is refused rather than sent: the backend's gate rule is
              // that a rejection carries a reason, and a blank one would be a
              // decision with no usable content behind it.
              disabled={disabled || !reason.trim()}
              onClick={() => answer(reasoning, reason)}
            >
              Send
            </Button>
            <Button
              variant="secondary"
              disabled={disabled}
              onClick={() => {
                setReasoning(null);
                setReason("");
              }}
            >
              Back
            </Button>
          </div>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {intervention.choices.map((choice) => (
            <li key={choice.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => choose(choice)}
                // Identical styling for every choice, deliberately. See rule 1.
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-muted/40 disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="block text-sm font-medium text-accent">
                  {choice.label}
                </span>
                <span className="mt-0.5 block text-xs text-muted">{choice.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!answered && intervention.answer_in_words && (
        <p className="mt-2.5 text-xs text-muted">
          None of these? Just say what you want in the box below — these are the common
          answers, not the only ones.
        </p>
      )}
    </section>
  );
}
