"use client";

import Link from "next/link";

import { CheckpointTimeline } from "@/components/catia/checkpoint-timeline";
import { useCatiaStatus } from "@/hooks/use-catia-status";
import type { CatiaConnectionState, CatiaStatusOnline } from "@/types/catia";
import { isLocalKernel } from "@/types/catia";

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
 * CATIA's interface language is chosen at install time on the workstation and shown as the
 * two letters it reports. Empty is normal (the daemon could not tell), and is said as such
 * rather than left blank: a blank reads as a missing value, and here it is a real answer.
 */
function languageLabel(code: string): string {
  return code ? code.toUpperCase() : "not reported";
}

/** The facts about the connected seat that decide what the assistant can do there. */
function SeatFacts({ seat }: { seat: CatiaStatusOnline }) {
  const rows: Array<[string, string]> = [
    ["Workstation", seat.hostname ? `${seat.device_name} (${seat.hostname})` : seat.device_name],
    ["CATIA", seat.mock ? `${seat.catia_version} · simulated` : seat.catia_version],
    ["Interface language", languageLabel(seat.ui_language)],
    ["Document", seat.document?.doc_name ?? "none open for this conversation"],
    [
      "Queue",
      seat.queue_depth === 0
        ? "idle"
        : `${seat.queue_depth} operation${seat.queue_depth === 1 ? "" : "s"} waiting`,
    ],
  ];
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 border-t border-border px-4 py-3 text-xs">
      {rows.map(([name, value]) => (
        <div key={name} className="contents">
          <dt className="text-muted">{name}</dt>
          <dd className="min-w-0 truncate font-mono text-accent" title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
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
export function CatiaBridgePanel({ conversationId }: { conversationId?: string | null } = {}) {
  const { state, status, detail, events } = useCatiaStatus(conversationId);

  return (
    <div className="k-panel">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-4 py-3">
        <span className={`size-2 rounded-full ${DOT[state]}`} aria-hidden="true" />
        <span className="text-sm font-medium text-accent">{HEADING[state]}</span>
        {/* Which build is answering. On a seat that is CATIA's version; on the
            open kernel there is no CATIA at all and the honest answer is the
            OCCT build. `connected: true` is true of both, which is why this
            reads the narrowed status rather than the field — the untyped
            version of this line rendered an empty pill on every open-kernel
            deployment. */}
        {isLocalKernel(status) ? (
          <span className="rounded-sm bg-surface-sunken px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted">
            {status.backend_version}
          </span>
        ) : (
          status?.connected && (
            <span className="rounded-sm bg-surface-sunken px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted">
              {status.catia_version}
            </span>
          )
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

      {status?.connected && !isLocalKernel(status) && <SeatFacts seat={status} />}

      {/* The way back (ROAD_TO_10 5.7). Only where a conversation is named and a seat — not the
          open kernel, which has no restore — is what builds. */}
      {conversationId && state === "connected" && !isLocalKernel(status) && (
        <div className="border-t border-border">
          <h3 className="px-4 pt-3 text-xs font-medium uppercase tracking-wide text-muted">
            Checkpoints
          </h3>
          <CheckpointTimeline conversationId={conversationId} />
        </div>
      )}

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
