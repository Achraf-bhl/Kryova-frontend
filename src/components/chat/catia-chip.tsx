"use client";

import Link from "next/link";

import type { CatiaConnectionState } from "@/types/catia";

const DOT: Record<CatiaConnectionState, string> = {
  connected: "bg-live",
  connecting: "bg-warning k-pulse",
  offline: "bg-border-strong",
  unavailable: "bg-border-strong",
};

export interface CatiaChipProps {
  state: CatiaConnectionState;
  /** The sentence behind the dot: which workstation, or why there isn't one. */
  detail: string;
  /** The bound document, when this conversation owns one. */
  document?: string | null;
}

/**
 * Live CATIA status, sitting in the composer tray.
 *
 * Placed here rather than in a panel at the top of a project page because this
 * is the moment it matters: the user is about to type "make me a bracket", and
 * whether a workstation is listening decides whether that produces geometry or
 * an apology. It is a link, so the offline case leads somewhere — the pairing
 * flow in settings — instead of just being bad news.
 */
export function CatiaChip({ state, detail, document }: CatiaChipProps) {
  return (
    <Link
      href="/dashboard/settings#catia"
      title={detail}
      className="k-pill hover:border-border-strong"
      data-active={state === "connected" ? "true" : "false"}
    >
      <span className={`size-2 rounded-full ${DOT[state]}`} aria-hidden="true" />
      {/* The word never changes; the dot carries the state. */}
      <span className="font-mono text-xs">CATIA</span>
      {document && (
        <span className="max-w-28 truncate font-mono text-[0.6875rem] text-faint">{document}</span>
      )}
      <span className="sr-only">. {detail}</span>
    </Link>
  );
}
