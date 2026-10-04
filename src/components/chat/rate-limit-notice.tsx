"use client";

import { useEffect, useState } from "react";

import { formatWait } from "@/lib/rate-limit";

/**
 * "You can send again in 12 s", counting down, beside the composer (ROAD_TO_10 3.2).
 *
 * Mount it only while a wait is pending and key it on the moment it ends: the clock is read
 * when it mounts, and a component that stayed mounted across two waits would start the second
 * from the first one's last tick. It counts to a *moment* the server's `Retry-After` fixed, not
 * down from a number, so a tab left in the background is correct the instant it wakes — and when
 * the moment passes it says so and stops, instead of leaving a stale "12 s" on screen.
 */
export interface RateLimitNoticeProps {
  /** Epoch ms at which sending is allowed again. */
  retryAt: number;
}

export function RateLimitNotice({ retryAt }: RateLimitNoticeProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (Date.now() >= retryAt) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= retryAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  const remaining = Math.ceil((retryAt - now) / 1000);
  return (
    <p
      role="status"
      className="mb-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted"
    >
      {remaining > 0
        ? `You can send again in ${formatWait(remaining)}.`
        : "You can send again now."}
    </p>
  );
}
