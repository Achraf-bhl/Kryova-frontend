/**
 * Wording for the operator's latency and cost view (ROAD_TO_10 9.6), as pure functions so the
 * rules that keep it honest are tested rather than remembered:
 *
 * - a percentile of a small sample is the maximum and is **labelled the maximum**, never p95;
 * - money is integer micro-dollars and is formatted without floating-point drift, and `null`
 *   is "no price configured", never "$0.00";
 * - a duration is shown in the unit a reader compares in, and the slowest tail comes first.
 */

import type { OperationLatency, SiteLatency } from "@/types/api";

/** "850 ms", "4.2 s", "3 min 05 s" — a span of seconds in the unit it is read in. */
export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  if (rest === 60) return `${minutes + 1} min 00 s`;
  return `${minutes} min ${String(rest).padStart(2, "0")} s`;
}

export function formatMillis(ms: number): string {
  return formatSeconds(ms / 1000);
}

/**
 * Micro-dollars as dollars. Integer arithmetic until the last step, so 1_234_567 is exactly
 * "$1.23" and not a float that prints as 1.2345670000000002. Below a cent it shows the
 * fraction rather than rounding a real cost to "$0.00".
 */
export function formatMicroUsd(micro: number | null): string {
  if (micro === null) return "no price";
  const negative = micro < 0;
  const abs = Math.abs(Math.trunc(micro));
  const sign = negative ? "-" : "";
  if (abs > 0 && abs < 10_000) {
    // Under one cent: show it in cents with enough digits to be non-zero.
    return `${sign}${(abs / 10_000).toFixed(abs < 100 ? 3 : 2)}¢`;
  }
  const cents = Math.round(abs / 10_000);
  const dollars = Math.floor(cents / 100);
  return `${sign}$${dollars.toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
}

/** The column label for a tail figure: "p95" only when the sample can bear it. */
export function tailLabel(p95IsTheMaximum: boolean): string {
  return p95IsTheMaximum ? "max (too few for p95)" : "p95";
}

/** Slowest tail first, then name, so the operator's eye lands on what is slow. */
export function slowestFirst<T extends SiteLatency | OperationLatency>(rows: T[]): T[] {
  const tail = (row: T) => ("p95_seconds" in row ? row.p95_seconds : row.p95_ms / 1000);
  const name = (row: T) => ("name" in row ? row.name : row.tool);
  return [...rows].sort((a, b) => {
    const delta = tail(b) - tail(a);
    if (delta !== 0) return delta;
    return name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0;
  });
}

/** "12 of 5,000 failed", or nothing when none did. */
export function failureNote(failures: number, count: number): string | null {
  if (failures <= 0) return null;
  return `${failures.toLocaleString("en-US")} of ${count.toLocaleString("en-US")} failed`;
}
