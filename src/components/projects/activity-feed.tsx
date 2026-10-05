"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api-client";
import { actorLabel, groupByDay, mergePages } from "@/lib/activity-feed";
import type { ActivityEntry } from "@/types/api";

/**
 * Who did what in this project, newest first (ROAD_TO_10 7.5).
 *
 * The server merges the records of each kind of event and names an actor only where a row
 * says who; this renders that and adds nothing. "Show earlier" follows the cursor the
 * server returned, so a long history is a series of small reads and never one big one.
 */
export interface ActivityFeedProps {
  projectId: string;
  currentUserId: string | null;
}

type Load =
  | { kind: "loading" }
  | { kind: "ready"; entries: ActivityEntry[]; next: string | null }
  | { kind: "failed"; message: string };

export function ActivityFeed({ projectId, currentUserId }: ActivityFeedProps) {
  const [state, setState] = useState<Load>({ kind: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .projectActivity(projectId)
      .then((page) => {
        if (!cancelled) setState({ kind: "ready", entries: page.items, next: page.next_before });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: "failed",
            message: error instanceof ApiError ? error.message : "Could not load the activity.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const more = useCallback(async () => {
    if (state.kind !== "ready" || state.next === null) return;
    setLoadingMore(true);
    try {
      const page = await api.projectActivity(projectId, state.next);
      setState({
        kind: "ready",
        entries: mergePages(state.entries, page.items),
        next: page.next_before,
      });
    } catch (error) {
      setState({
        kind: "failed",
        message: error instanceof ApiError ? error.message : "Could not load more.",
      });
    } finally {
      setLoadingMore(false);
    }
  }, [projectId, state]);

  return (
    <section aria-label="Activity">
      <h2 className="mb-3 text-lg font-semibold">Activity</h2>
      <div className="rounded-lg bg-surface shadow-card">
        {state.kind === "loading" && <p className="px-5 py-4 text-sm text-muted">Loading…</p>}
        {state.kind === "failed" && (
          <p className="px-5 py-4 text-sm text-danger">{state.message}</p>
        )}
        {state.kind === "ready" && state.entries.length === 0 && (
          <p className="px-5 py-4 text-sm text-muted">Nothing has happened here yet.</p>
        )}
        {state.kind === "ready" &&
          groupByDay(state.entries).map((day) => (
            <div key={day.label} className="border-b border-border last:border-b-0">
              <h3 className="px-5 pt-3 text-xs font-medium uppercase tracking-wide text-muted">
                {day.label}
              </h3>
              <ul>
                {day.entries.map((entry) => (
                  <li
                    key={`${entry.kind}|${entry.target_id ?? ""}|${entry.at}`}
                    className="flex items-baseline justify-between gap-4 px-5 py-2 text-sm"
                  >
                    <span>
                      <span className="font-medium">{actorLabel(entry, currentUserId)}</span>{" "}
                      <span className="text-muted">{entry.summary}</span>
                    </span>
                    <time className="shrink-0 font-mono text-xs text-faint" dateTime={entry.at}>
                      {new Date(entry.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        {state.kind === "ready" && state.next !== null && (
          <div className="px-5 py-3">
            <button
              type="button"
              onClick={() => void more()}
              disabled={loadingMore}
              className="text-sm text-primary hover:underline disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Show earlier"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
