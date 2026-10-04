"use client";

import { useState } from "react";

import { useProjectMemory } from "@/hooks/use-project-memory";

/**
 * What the assistant would like to remember about this project, waiting for you
 * (ROAD_TO_10 2.7).
 *
 * **A suggestion, not a memory.** Nothing here has reached the model: the server only
 * ever sends confirmed facts, and says so in the tool's answer so the assistant does
 * not talk as if it were settled. "Keep" is the single door through which a suggestion
 * becomes something every future conversation in this project is told; "Dismiss"
 * deletes it. The sentence is the assistant's own and is rendered as plain text.
 *
 * Renders nothing when there is nothing to decide — most turns propose nothing, and a
 * permanent empty box above the composer is furniture. It re-reads when `revision`
 * moves, which the chat bumps once per finished turn: that is when a proposal can
 * have appeared, and polling would ask an unchanged list to resend itself.
 */
export interface MemoryProposalsProps {
  projectId: string;
  revision: number;
}

export function MemoryProposals({ projectId, revision }: MemoryProposalsProps) {
  const memory = useProjectMemory(projectId, revision);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  // A failed read is not worth a box above every composer: the project page says so.
  if (memory.state.kind !== "ready") return null;
  const proposals = memory.state.items.filter((item) => item.state === "proposed");
  if (proposals.length === 0) return null;

  async function decide(id: string, action: "keep" | "dismiss") {
    setWorking(id);
    setRefusal(null);
    const words = await (action === "keep" ? memory.confirm(id) : memory.forget(id));
    setRefusal(words);
    setWorking(null);
  }

  return (
    <section
      className="rounded-md border border-border bg-surface text-sm"
      aria-label="Suggested project facts"
    >
      <h3 className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">
        Suggested for this project · {proposals.length}
      </h3>
      <p className="px-3 pt-2 text-xs text-muted">
        The assistant has not been told these. Keep one and every conversation in this
        project will start knowing it.
      </p>
      <ul>
        {proposals.map((proposal) => (
          <li
            key={proposal.id}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2 last:border-0"
          >
            <span className="min-w-0 flex-1 break-words">{proposal.text}</span>
            <span className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={working === proposal.id}
                onClick={() => void decide(proposal.id, "keep")}
                aria-label={`Keep: ${proposal.text}`}
                className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-canvas disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Keep
              </button>
              <button
                type="button"
                disabled={working === proposal.id}
                onClick={() => void decide(proposal.id, "dismiss")}
                aria-label={`Dismiss: ${proposal.text}`}
                className="rounded-md px-2 py-1 text-xs text-muted hover:text-accent disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Dismiss
              </button>
            </span>
          </li>
        ))}
      </ul>
      {refusal && (
        <p role="alert" className="px-3 pb-2 text-xs text-danger">
          {refusal}
        </p>
      )}
    </section>
  );
}
