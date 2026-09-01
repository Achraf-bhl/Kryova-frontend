"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { toPlainText } from "@/lib/markdown";

/**
 * Copy an assistant answer to the clipboard.
 *
 * Copies the **rendered** text, not the markdown source. An engineer pasting an
 * answer into a ticket or an email wants the sentence, not `**Peak stress**` —
 * and `toPlainText` is already the function the screen-reader announcement uses,
 * so what is copied is what was read aloud, which is what was on screen.
 *
 * `navigator.clipboard` is absent over plain http on a non-localhost origin and
 * in some embedded webviews, and it rejects when the document is not focused.
 * Both are ordinary, so failure is shown on the button rather than thrown: a
 * copy that silently does nothing is worse than one that says it could not.
 */
const FEEDBACK_MS = 1600;

type State = "idle" | "copied" | "failed";

export interface CopyButtonProps {
  /** Markdown source of the answer. Rendered to plain text before copying. */
  content: string;
  className?: string;
}

export function CopyButton({ content, className = "" }: CopyButtonProps) {
  const [state, setState] = useState<State>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A component unmounted inside the feedback window (the user navigates to
  // another conversation right after copying) would otherwise set state on a
  // gone component.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(toPlainText(content));
      setState("copied");
    } catch {
      setState("failed");
    }
    timer.current = setTimeout(() => setState("idle"), FEEDBACK_MS);
  }, [content]);

  const label =
    state === "copied" ? "Copied" : state === "failed" ? "Press Ctrl+C" : "Copy";

  return (
    <button
      type="button"
      onClick={() => void copy()}
      // The transcript is not a live region, so a state change here would go
      // unannounced without an explicit label change on the control itself.
      aria-label={state === "idle" ? "Copy this answer" : label}
      className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-faint transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`}
    >
      <CopyGlyph done={state === "copied"} />
      <span>{label}</span>
    </button>
  );
}

function CopyGlyph({ done }: { done: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {done ? (
        <path d="M3 8.5 6.5 12 13 4.5" />
      ) : (
        <>
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
          <path d="M10.5 5.5v-1a1.5 1.5 0 0 0-1.5-1.5H4a1.5 1.5 0 0 0-1.5 1.5V9A1.5 1.5 0 0 0 4 10.5h1" />
        </>
      )}
    </svg>
  );
}
