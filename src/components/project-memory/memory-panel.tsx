"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useProjectMemory } from "@/hooks/use-project-memory";
import type { ProjectMemoryRead } from "@/types/api";

/**
 * What this project remembers, on the project page (ROAD_TO_10 2.7).
 *
 * **The user's list, not the assistant's.** Every confirmed fact is sent to the model at
 * the start of every conversation in this project, so the panel says that in words above
 * the list and lets the user reword or delete any of them. A fact nobody can correct is
 * an instruction nobody can retract.
 *
 * Suggestions the assistant made sit in their own group, labelled as not yet told. They
 * are decided in the chat as well (`MemoryProposals`); both go through one hook, so the
 * two surfaces cannot disagree about what the server holds.
 *
 * Writing is a project member's. A viewer sees the list, and the server answers their
 * write with a 404 that this panel shows as words next to the control rather than
 * hiding the controls on a guess about their role.
 */
export interface ProjectMemoryPanelProps {
  projectId: string;
}

export function ProjectMemoryPanel({ projectId }: ProjectMemoryPanelProps) {
  const memory = useProjectMemory(projectId);
  const [draft, setDraft] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    setRefusal(null);
    const words = await memory.add(text);
    setSaving(false);
    if (words) setRefusal(words);
    else setDraft("");
  }

  const body = (() => {
    if (memory.state.kind === "loading") {
      return <p className="px-5 py-4 text-sm text-muted">Loading…</p>;
    }
    if (memory.state.kind === "failed") {
      return <p className="px-5 py-4 text-sm text-danger">{memory.state.message}</p>;
    }
    const confirmed = memory.state.items.filter((item) => item.state === "confirmed");
    const proposed = memory.state.items.filter((item) => item.state === "proposed");
    return (
      <>
        {confirmed.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">Nothing remembered yet.</p>
        ) : (
          <ul aria-label="Remembered facts">
            {confirmed.map((fact) => (
              <FactRow key={fact.id} fact={fact} controller={memory} />
            ))}
          </ul>
        )}
        {proposed.length > 0 && (
          <div className="border-t border-border">
            <h3 className="px-5 pt-3 text-xs font-medium uppercase tracking-wide text-muted">
              Suggested by the assistant · not yet told
            </h3>
            <ul aria-label="Suggested facts">
              {proposed.map((fact) => (
                <FactRow key={fact.id} fact={fact} controller={memory} />
              ))}
            </ul>
          </div>
        )}
        <p className="border-t border-border px-5 py-2 text-xs text-muted">
          {confirmed.length} of {memory.state.limit} facts used
        </p>
      </>
    );
  })();

  return (
    <section aria-label="Project memory">
      <h2 className="mb-1 text-lg font-semibold">Project memory</h2>
      <p className="mb-3 max-w-2xl text-sm text-muted">
        Short facts that are true of every conversation in this project — materials,
        standards, units. The assistant is told each one at the start of every
        conversation, so keep them to what you would want it to know without asking.
      </p>
      <div className="rounded-lg bg-surface shadow-card">
        <form onSubmit={(event) => void add(event)} className="flex gap-2 border-b border-border p-4">
          <label className="sr-only" htmlFor="project-memory-new">
            New project fact
          </label>
          <input
            id="project-memory-new"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="e.g. Fasteners are ISO 4762 A2-70 stainless"
            maxLength={1200}
            className="min-w-0 flex-1 rounded-md border border-border bg-canvas px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary"
          />
          <Button type="submit" disabled={saving || draft.trim() === ""}>
            Add
          </Button>
        </form>
        {refusal && (
          <p role="alert" className="border-b border-border px-5 py-2 text-sm text-danger">
            {refusal}
          </p>
        )}
        {body}
      </div>
    </section>
  );
}

function FactRow({
  fact,
  controller,
}: {
  fact: ProjectMemoryRead;
  controller: ReturnType<typeof useProjectMemory>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.text);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function act(action: () => Promise<string | null>, done?: () => void) {
    setWorking(true);
    setRefusal(null);
    const words = await action();
    setWorking(false);
    if (words) setRefusal(words);
    else done?.();
  }

  const proposed = fact.state === "proposed";

  return (
    <li className="border-b border-border/60 px-5 py-3 text-sm last:border-0">
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void act(
              () => controller.edit(fact.id, text.trim()),
              () => setEditing(false),
            );
          }}
          className="flex gap-2"
        >
          <label className="sr-only" htmlFor={`memory-${fact.id}`}>
            Reword this fact
          </label>
          <input
            id={`memory-${fact.id}`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={1200}
            className="min-w-0 flex-1 rounded-md border border-border bg-canvas px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-primary"
          />
          <Button type="submit" disabled={working || text.trim() === ""}>
            Save
          </Button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setText(fact.text);
              setRefusal(null);
            }}
            className="text-xs text-muted hover:text-accent"
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* The sentence is the user's or the assistant's own text, rendered as text. */}
          <span className="min-w-0 flex-1 break-words">{fact.text}</span>
          <span className="flex shrink-0 gap-3 text-xs">
            {proposed ? (
              <button
                type="button"
                disabled={working}
                onClick={() => void act(() => controller.confirm(fact.id))}
                aria-label={`Keep: ${fact.text}`}
                className="font-medium text-primary hover:underline disabled:opacity-50"
              >
                Keep
              </button>
            ) : (
              <button
                type="button"
                disabled={working}
                onClick={() => setEditing(true)}
                aria-label={`Edit: ${fact.text}`}
                className="text-muted hover:text-accent disabled:opacity-50"
              >
                Edit
              </button>
            )}
            <button
              type="button"
              disabled={working}
              onClick={() => void act(() => controller.forget(fact.id))}
              aria-label={`${proposed ? "Dismiss" : "Delete"}: ${fact.text}`}
              className="text-muted hover:text-danger disabled:opacity-50"
            >
              {proposed ? "Dismiss" : "Delete"}
            </button>
          </span>
        </div>
      )}
      {refusal && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {refusal}
        </p>
      )}
    </li>
  );
}
