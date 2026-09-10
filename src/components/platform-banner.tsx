"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import type { AnnouncementLevel, PlatformState } from "@/types/api";

/**
 * The maintenance notice and any live announcements (P3.7).
 *
 * **Polled rather than pushed**, on a slow interval. A banner is not
 * time-critical to the second, and an SSE stream for it would be a second
 * long-lived connection per tab competing with the one the chat actually needs.
 *
 * **Every failure is silent.** This is furniture: a user whose network hiccups
 * should not get an error about the banner system on top of whatever else is
 * wrong. If it cannot load, it renders nothing — which is also the correct
 * state when there is nothing to say.
 *
 * Maintenance is shown above announcements and cannot be dismissed, because it
 * is the one that explains why the thing the user just tried did not work.
 */

const POLL_MS = 60_000;

const LEVEL_STYLES: Record<AnnouncementLevel, string> = {
  info: "border-border bg-surface text-accent",
  warning: "border-warning/40 bg-warning/5 text-accent",
  critical: "border-danger/40 bg-danger/5 text-danger",
};

export function PlatformBanner() {
  const [state, setState] = useState<PlatformState | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .platformState()
        .then((next) => {
          if (!cancelled) setState(next);
        })
        .catch(() => {
          // Silent by design — see the component note.
        });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!state) return null;

  const announcements = state.announcements.filter((row) => !dismissed.has(row.id));
  if (!state.maintenance && announcements.length === 0) return null;

  return (
    <div className="space-y-2 px-4 pt-3">
      {state.maintenance && (
        <div
          role="alert"
          className="rounded-md border border-warning/40 bg-warning/5 px-4 py-3"
        >
          <p className="text-sm font-medium text-accent">Kryova is read-only right now</p>
          <p className="mt-1 text-sm text-muted">{state.maintenance.message}</p>
        </div>
      )}
      {announcements.map((announcement) => (
        <div
          key={announcement.id}
          role="status"
          className={`flex items-start gap-3 rounded-md border px-4 py-3 ${LEVEL_STYLES[announcement.level]}`}
        >
          <p className="flex-1 text-sm">{announcement.message}</p>
          <button
            type="button"
            onClick={() =>
              setDismissed((previous) => new Set(previous).add(announcement.id))
            }
            className="text-xs text-muted hover:text-accent"
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
