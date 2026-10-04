"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import type { AIOrgNotice, AIUsage } from "@/types/api";

/**
 * The AI spending notices (ROAD_TO_10 1.3 / master plan P11.9): an organisation nearing or past
 * its cap, and the reason the next turn would be refused.
 *
 * **Polled on a slow interval and again when the tab comes back.** The numbers are sums over
 * the ledger, not something a stream pushes, and a user who left the tab at 79 % and returns
 * after a long turn should not read a stale figure — so a visible tab refreshes at once. Five
 * minutes, not the platform banner's one, because each read is a ledger sum.
 *
 * **Every failure is silent**, for the platform banner's reason: this is furniture, and a user
 * whose network hiccups should not get an error about it on top of whatever else is wrong.
 *
 * **What cannot be dismissed is what explains a refusal.** A warning can be closed for the
 * page; an exhausted cap and a blocked turn stay, because they are why the thing the user just
 * tried did not work.
 */

const POLL_MS = 5 * 60_000;

export function AiBudgetBanner() {
  const [usage, setUsage] = useState<AIUsage | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .aiUsage()
        .then((next) => {
          if (!cancelled) setUsage(next);
        })
        .catch(() => {
          // Silent by design — see the component note.
        });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    load();
    const timer = setInterval(load, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!usage) return null;

  const blocked = usage.blocked;
  // A blocked turn usually *is* the exhausted cap, in the same words; say it once.
  const notices = usage.notices.filter(
    (notice) =>
      notice.message !== blocked && !dismissed.has(noticeKey(notice)),
  );
  if (!blocked && notices.length === 0) return null;

  return (
    <div className="space-y-2 px-4 pt-3" data-testid="ai-budget-banner">
      {blocked && (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/5 px-4 py-3"
        >
          <p className="text-sm font-medium text-danger">The assistant cannot take a new request</p>
          <p className="mt-1 text-sm text-accent">{blocked}</p>
        </div>
      )}
      {notices.map((notice) =>
        notice.level === "exhausted" ? (
          <div
            key={noticeKey(notice)}
            role="alert"
            className="rounded-md border border-danger/40 bg-danger/5 px-4 py-3"
          >
            <p className="text-sm text-danger">{notice.message}</p>
          </div>
        ) : (
          <div
            key={noticeKey(notice)}
            role="status"
            className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/5 px-4 py-3 text-accent"
          >
            <p className="flex-1 text-sm">{notice.message}</p>
            <button
              type="button"
              onClick={() =>
                setDismissed((previous) => new Set(previous).add(noticeKey(notice)))
              }
              className="text-xs text-muted hover:text-accent"
              aria-label="Dismiss"
            >
              Dismiss
            </button>
          </div>
        ),
      )}
    </div>
  );
}

function noticeKey(notice: AIOrgNotice): string {
  return `${notice.period}:${notice.level}`;
}
