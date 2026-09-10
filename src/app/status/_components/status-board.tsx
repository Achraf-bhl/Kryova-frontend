"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import type { ServiceState, ServiceStatus } from "@/types/api";

/**
 * The status board (P10.4).
 *
 * **When the status page itself cannot be reached, it says so plainly.** That is
 * the one case a status page has to handle well and the one most of them handle
 * worst: a spinner forever, or a cheerful green panel rendered from stale state.
 * If this fetch fails, the honest reading is "we cannot tell you", and it points
 * at the thing that is definitely down — the API — rather than guessing.
 */

const STATE_STYLE: Record<ServiceState, { dot: string; text: string }> = {
  operational: { dot: "bg-success", text: "text-success" },
  // Amber, not red. Read-only for maintenance is the product working as
  // designed; reads and navigation keep going.
  maintenance: { dot: "bg-warning", text: "text-warning" },
  degraded: { dot: "bg-danger", text: "text-danger" },
};

export function StatusBoard() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .serviceStatus()
        .then((body) => {
          if (!live) return;
          setStatus(body);
          setUnreachable(false);
        })
        .catch(() => live && setUnreachable(true));

    void load();
    // Thirty seconds, matching the backend's cache header. Polling faster would
    // only re-read the same cached body.
    const timer = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  if (unreachable) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-danger/40 bg-surface p-5 shadow-card"
      >
        <p className="font-medium text-danger">We cannot reach Kryova to check.</p>
        <p className="mt-1 text-sm text-muted">
          {/* Not "everything is fine" and not a spinner. The one thing this page
              knows for certain right now is that the API did not answer it. */}
          This page asks the API the same way the product does, so if it cannot
          get an answer, the API is very likely the thing that is down.
        </p>
      </div>
    );
  }

  if (!status) {
    return <p className="text-sm text-muted">Checking…</p>;
  }

  const style = STATE_STYLE[status.state];

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-surface p-5 shadow-card">
        <div className="flex items-center gap-2">
          <span className={`size-2.5 rounded-full ${style.dot}`} aria-hidden />
          <p className={`font-medium ${style.text}`}>{status.summary}</p>
        </div>
        {status.notice && <p className="mt-2 text-sm text-muted">{status.notice}</p>}
      </section>

      {status.announcements.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-muted">Notices</h2>
          <ul className="mt-2 space-y-2">
            {status.announcements.map((announcement, index) => (
              <li
                key={`${announcement.level}-${index}`}
                className={`rounded-md border border-border bg-surface px-4 py-3 text-sm ${
                  announcement.level === "critical" ? "text-danger" : "text-accent"
                }`}
              >
                {announcement.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-sm font-medium text-muted">
          Recent maintenance · last {status.history_days} days
        </h2>
        {status.history.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            {/* An empty history is a fact worth stating, not a blank space that
                reads like a page that failed to load. */}
            No maintenance windows in that period.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-md border border-border bg-surface">
            {status.history.map((incident) => (
              <li key={incident.started_at} className="px-4 py-3">
                <p className="text-sm">{incident.message}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {relativeTime(incident.started_at)} ·{" "}
                  {incident.ongoing
                    ? "ongoing"
                    : incident.minutes === null
                      ? "duration not recorded"
                      : `${incident.minutes} min`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
