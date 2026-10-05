"use client";

import { useId, useState } from "react";

import { CheckpointTimeline } from "@/components/catia/checkpoint-timeline";

/**
 * The way back to an earlier state of the part, in the conversation's header.
 *
 * Only offered where a rollback means something: a seat that holds a bound document (the open
 * kernel has no `catia_restore`). It is a disclosure rather than a page because it is wanted
 * rarely and urgently — right after the assistant did something the user does not want — and
 * it has to be one click away from the conversation that did it.
 */
export function CheckpointsMenu({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div
      className="relative shrink-0"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        className="k-pill"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        Checkpoints
      </button>
      {open && (
        <div
          id={panelId}
          className="absolute right-0 top-full z-20 mt-2 w-[min(30rem,90vw)] rounded-md border border-border bg-surface shadow-card"
        >
          <CheckpointTimeline conversationId={conversationId} />
        </div>
      )}
    </div>
  );
}
