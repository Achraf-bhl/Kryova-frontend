"use client";

import { useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api-client";
import {
  extractionLabel,
  type AttachmentExtraction,
  type AttachmentRead,
} from "@/types/api";

/**
 * What this conversation has been handed, and what was read out of it (P4.6).
 *
 * **The list is complete, including what could not be read.** A panel that
 * quietly omitted the STEP file somebody dropped in would leave them wondering
 * whether it uploaded at all — and the answer to "why is my STEP file not in
 * the list" is much harder to find than the answer to "why does it say *not a
 * document*".
 *
 * **"Not a document" is not "failed", and they are coloured differently.** A
 * STEP file in the document slot is geometry: the file is fine, it is in the
 * wrong place, and the detail says what to do with it instead. Rendering it in
 * red beside a genuine read failure tells somebody their file is corrupt when
 * it is not.
 *
 * **An inferred read carries its warning wherever the content goes.** The
 * sentence comes from the server (`unverified_note`) rather than being composed
 * here: a wrongly read tolerance is worse than an unread one, and a safety label
 * with two implementations has two standards. It is rendered *above* the
 * extracted text, not below it, for the same reason the verification summary
 * sits above the result numbers — a caveat under something already believed is
 * a footnote.
 *
 * **Dimensions are shown as candidates and never applied.** The phase stages
 * dimension and GD&T extraction as later, research-adjacent work explicitly not
 * promised early. There is deliberately no "use this value" button here.
 */

type Loaded =
  | { kind: "loading" }
  | { kind: "ready"; items: AttachmentRead[] }
  | { kind: "failed"; message: string };

export interface AttachmentPanelProps {
  conversationId: string;
  /** Bumped by the caller when something may have been attached. */
  revision?: number;
}

export function AttachmentPanel({ conversationId, revision = 0 }: AttachmentPanelProps) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listAttachments(conversationId)
      .then((page) => {
        if (!cancelled) setLoaded({ kind: "ready", items: page.items });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoaded({
          kind: "failed",
          message:
            error instanceof ApiError ? error.message : "The attachments could not be listed.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, revision]);

  if (loaded.kind === "loading") return null;
  if (loaded.kind === "failed") {
    return (
      <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted">
        {loaded.message}
      </p>
    );
  }
  // Nothing attached is the ordinary case, and a permanent empty box above the
  // composer is furniture.
  if (loaded.items.length === 0) return null;

  return (
    <section
      className="rounded-md border border-border bg-surface text-sm"
      aria-label="Attachments"
    >
      <h3 className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted">
        Attached · {loaded.items.length}
      </h3>
      <ul>
        {loaded.items.map((attachment) => (
          <li key={attachment.id} className="border-b border-border/60 last:border-0">
            <button
              type="button"
              onClick={() => setOpen((current) => (current === attachment.id ? null : attachment.id))}
              aria-expanded={open === attachment.id}
              className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {/* The filename is the user's own text and is rendered as text.
                  There is no `dangerouslySetInnerHTML` in this repo and this is
                  not the place to introduce one. */}
              <span className="min-w-0 flex-1 truncate">{attachment.filename}</span>
              <StatusChip attachment={attachment} />
            </button>
            {attachment.status_detail && (
              <p className="px-3 pb-2 text-xs text-muted">{attachment.status_detail}</p>
            )}
            {open === attachment.id && attachment.status === "ready" && (
              <Extraction attachmentId={attachment.id} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusChip({ attachment }: { attachment: AttachmentRead }) {
  // Three tones, not two. `unsupported` is amber rather than red because the
  // file is fine — it is in the wrong slot, and the detail says which slot.
  const tone =
    attachment.status === "ready"
      ? "text-muted"
      : attachment.status === "failed"
        ? "text-danger"
        : "text-warning";
  return (
    <span className={`shrink-0 text-xs ${tone}`}>
      {extractionLabel(attachment.status)}
      {attachment.needs_confirmation && attachment.status === "ready" ? " · unverified" : ""}
    </span>
  );
}

function Extraction({ attachmentId }: { attachmentId: string }) {
  const [state, setState] = useState<AttachmentExtraction | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Promise callbacks rather than `await` in the effect body: this repo's
    // lint refuses a `setState` the checker can trace to an effect, and the
    // `cancelled` flag is what makes a panel closed mid-fetch not write into a
    // component that is gone.
    let cancelled = false;
    api
      .readExtraction(attachmentId)
      .then((extraction) => {
        if (!cancelled) setState(extraction);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "That extraction could not be read.");
      });
    return () => {
      cancelled = true;
    };
  }, [attachmentId]);

  if (error) return <p className="px-3 pb-2 text-xs text-danger">{error}</p>;
  if (!state) return <p className="px-3 pb-2 text-xs text-muted">Reading…</p>;

  return (
    <div className="space-y-2 px-3 pb-3">
      {/* Above the content, not below it. A caveat under something already
          believed is a footnote — the same argument the verification summary
          makes about sitting above a factor of safety. */}
      {state.unverified_note && (
        <p role="note" className="rounded-sm border border-warning/40 bg-warning/5 px-2 py-1.5 text-xs text-warning">
          {state.unverified_note}
        </p>
      )}

      {state.notes.map((note) => (
        <p key={note} className="text-xs text-muted">
          {note}
        </p>
      ))}

      {state.dimensions.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-muted">
            Dimensions found — {state.dimensions.length}
          </h4>
          {/* Candidates. There is deliberately no "use this value" action:
              dimension and GD&T extraction is staged as later work, and a
              wrongly read tolerance is worse than an unread one. */}
          <p className="text-[11px] text-muted">
            Candidate readings only. Check each against the drawing before using it.
          </p>
          <ul className="mt-1 space-y-0.5">
            {state.dimensions.map((fragment, index) => (
              <li key={`${fragment.where}-${index}`} className="font-mono text-xs">
                {fragment.text}
                {fragment.where && <span className="text-muted"> — {fragment.where}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.unread.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-muted">
            Seen but not interpreted — {state.unread.length}
          </h4>
          {/* Not errors: the extraction succeeded. This is the reader saying it
              saw something and would rather say so than guess. */}
          <ul className="mt-1 space-y-0.5 text-xs text-muted">
            {state.unread.map((item, index) => (
              <li key={index}>{item.why}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[11px] text-muted">
        {state.fragment_count} fragment{state.fragment_count === 1 ? "" : "s"}, read by{" "}
        {state.reader}
        {/* Said, never hidden: a silently shortened extraction reads as a short
            document. */}
        {state.truncated ? ` — only the first ${state.fragments.length} are kept here` : ""}
      </p>
    </div>
  );
}
