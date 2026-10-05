"use client";

import { useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/api-client";
import { INITIAL_WATCH, PROBE_INTERVAL_MS, next, probe, type Watch } from "@/lib/backend-watch";
import { healthUrl } from "@/lib/machine-checks";
import {
  CAPABILITIES,
  availability,
  explain,
  summarise,
} from "@/lib/offline-capability";

/**
 * When the server cannot be reached, say which features stop and which keep working
 * (ROAD_TO_10 8.2, wiring `offline-capability.ts`). Counts in the banner, the per-feature
 * sentences one click away; nothing is shown while the server is up or not yet known.
 *
 * Probes `/health` every 20 s while the tab is visible and on the browser's own
 * online/offline events. `backend-watch.ts` decides when a failure is believed.
 */
export function OfflineBanner() {
  const [watch, setWatch] = useState<Watch>(INITIAL_WATCH);

  useEffect(() => {
    let stopped = false;
    const url = healthUrl(API_BASE_URL);
    const run = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const result = await probe(url);
      if (!stopped) setWatch((previous) => next(previous, result));
    };
    void run();
    const timer = setInterval(() => void run(), PROBE_INTERVAL_MS);
    const nudge = () => void run();
    window.addEventListener("online", nudge);
    window.addEventListener("offline", nudge);
    document.addEventListener("visibilitychange", nudge);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("online", nudge);
      window.removeEventListener("offline", nudge);
      document.removeEventListener("visibilitychange", nudge);
    };
  }, []);

  const summary = summarise(watch.state);
  if (!summary.banner) return null;

  return (
    <div role="status" className="mx-4 mt-3 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
      <p>{summary.banner}</p>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-muted">What still works</summary>
        <ul className="mt-1 space-y-0.5 text-xs">
          {CAPABILITIES.map((capability) => {
            const verdict = availability(capability.id, watch.state);
            return (
              <li key={capability.id}>
                <span className="font-medium">{capability.label}</span>
                {" — "}
                {verdict === "available"
                  ? "works"
                  : (explain(capability.id, watch.state) ?? verdict)}
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
