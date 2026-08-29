"use client";

import Link from "next/link";

import { useCatiaStatus } from "@/hooks/use-catia-status";
import type { CatiaConnectionState } from "@/types/catia";

const DOT: Record<CatiaConnectionState, string> = {
  connected: "bg-live",
  connecting: "bg-warning k-pulse",
  offline: "bg-border-strong",
  unavailable: "bg-border-strong",
};

const HEADING: Record<CatiaConnectionState, string> = {
  connected: "CATIA connected",
  connecting: "Checking CATIA…",
  offline: "CATIA offline",
  unavailable: "CATIA unavailable",
};

function humanEvent(name: string): string {
  return name.replace(/_/g, " ");
}

/**
 * CATIA bridge state, as a panel.
 *
 * Rewritten against the real backend endpoints: the previous version polled
 * `http://localhost:9100`, a local HTTP daemon that this architecture has never
 * had — the bridge dials **out** to the backend, and the browser asks the
 * backend. It therefore reported "error" on every machine, forever.
 *
 * The live signal a user needs while working now lives in the composer chip;
 * this panel is the fuller read (which workstation, what it just did) for the
 * project page and settings.
 */
export function CatiaBridgePanel() {
  const { state, status, detail, events } = useCatiaStatus();

  return (
    <div className="k-panel">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-3">
        <span className={`size-2 rounded-full ${DOT[state]}`} aria-hidden="true" />
        <span className="text-sm font-medium text-accent">{HEADING[state]}</span>
        {status?.connected && (
          <span className="rounded-sm bg-surface-sunken px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted">
            {status.catia_version}
          </span>
        )}
        <Link
          href="/dashboard/settings#catia"
          className="ml-auto text-xs text-muted underline-offset-2 hover:text-accent hover:underline"
        >
          {state === "connected" ? "Manage" : "Connect a workstation"}
        </Link>
      </div>

      <p className="px-4 py-3 text-sm text-muted" aria-live="polite">
        {detail}
      </p>

      {events.length > 0 && (
        <ul className="k-scroll max-h-40 overflow-y-auto border-t border-border px-4 py-2">
          {events.slice(0, 10).map((event) => (
            <li key={`${event.at}-${event.event}`} className="flex items-center gap-2 py-0.5 text-xs">
              <span className="size-1.5 shrink-0 rounded-full bg-border-strong" aria-hidden="true" />
              <span className="text-muted">{humanEvent(event.event)}</span>
              <span className="ml-auto font-mono text-faint">
                {new Date(event.at).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
