import { isDown, stateFromProbe, type BackendState } from "@/lib/offline-capability";

/**
 * Turning a stream of probes into the state the banner shows (ROAD_TO_10 8.2).
 *
 * `offline-capability.ts` decides what each state means; this decides when to believe one.
 * **One failed probe is not an outage** — a request can be dropped by a sleeping laptop or a
 * proxy blinking — and a banner that flashed "No connection" on every blip would train
 * people to ignore the one that matters. So the state goes down only after
 * `STRIKES_TO_FALL` failing probes in a row, and comes back on the first good one: being
 * slow to say "down" is cheap, and being slow to say "back" leaves a working app labelled
 * broken.
 */

export const STRIKES_TO_FALL = 2;
export const PROBE_INTERVAL_MS = 20_000;
export const PROBE_TIMEOUT_MS = 5_000;

export interface Watch {
  /** What the banner shows. */
  readonly state: BackendState;
  /** Consecutive probes that failed, since the last good one. */
  readonly strikes: number;
}

export const INITIAL_WATCH: Watch = { state: "unknown", strikes: 0 };

export function next(previous: Watch, probed: BackendState): Watch {
  if (!isDown(probed)) return { state: probed, strikes: 0 };
  const strikes = previous.strikes + 1;
  if (strikes < STRIKES_TO_FALL) {
    // Not yet believed: keep showing what was true before.
    return { state: previous.state, strikes };
  }
  return { state: probed, strikes };
}

/** One probe of `url`: the HTTP status, or null when nothing answered. */
export async function probe(
  url: string,
  fetcher: typeof fetch = fetch,
  onLine: boolean = typeof navigator === "undefined" ? true : navigator.onLine,
): Promise<BackendState> {
  if (!onLine) return stateFromProbe(null, false);
  try {
    const response = await fetcher(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return stateFromProbe(response.status, true);
  } catch {
    return stateFromProbe(null, true);
  }
}
