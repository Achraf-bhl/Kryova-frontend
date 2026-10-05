import type { ActivityEntry } from "@/types/api";

/**
 * The project activity feed, as a pure function of what the server returned
 * (ROAD_TO_10 7.5).
 *
 * Two rules. The feed **names an actor only where the server did** — a geometry
 * upload and a queued run record no author, so they read "someone", not the project
 * owner; and **the agent is the agent**, never "you". A feed that credits an
 * unattributed row to whoever is looking is the one that gets quoted back in a
 * dispute about who changed what.
 */

export interface ActivityDay {
  /** "Today", "Yesterday", or a date the reader's locale prints. */
  label: string;
  entries: ActivityEntry[];
}

export function actorLabel(entry: ActivityEntry, currentUserId: string | null): string {
  if (entry.actor_kind === "agent") return "The agent";
  if (entry.actor_kind === "user") {
    if (currentUserId !== null && entry.actor_user_id === currentUserId) return "You";
    return entry.actor_email ?? "A colleague";
  }
  return "Someone";
}

const SAME_DAY = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Group newest-first entries by the reader's calendar day, preserving order. */
export function groupByDay(entries: ActivityEntry[], now: Date = new Date()): ActivityDay[] {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const days: ActivityDay[] = [];
  for (const entry of entries) {
    const at = new Date(entry.at);
    if (Number.isNaN(at.getTime())) continue;
    const label = SAME_DAY(at, now)
      ? "Today"
      : SAME_DAY(at, yesterday)
        ? "Yesterday"
        : at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const last = days[days.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else days.push({ label, entries: [entry] });
  }
  return days;
}

/** Entries not already shown, by kind + target + time — a page boundary may repeat one. */
export function mergePages(shown: ActivityEntry[], next: ActivityEntry[]): ActivityEntry[] {
  const key = (e: ActivityEntry) => `${e.kind}|${e.target_id ?? ""}|${e.at}`;
  const seen = new Set(shown.map(key));
  return [...shown, ...next.filter((e) => !seen.has(key(e)))];
}

/** A tag field's text as the list the API takes: comma-separated, trimmed, no blanks. */
export function parseTagInput(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
