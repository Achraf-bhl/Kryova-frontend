import type { ConversationSummary } from "@/types/conversation";

/**
 * Sidebar grouping.
 *
 * Extracted as a pure function rather than computed inside the sidebar
 * component: it is date arithmetic across a boundary that only moves at
 * midnight, which is exactly the kind of thing that is wrong for a few hours a
 * day and unreachable from a component test.
 */

export type ConversationGroupLabel = "Today" | "Yesterday" | "Previous 7 days" | "Older";

export interface ConversationGroup {
  label: ConversationGroupLabel;
  items: ConversationSummary[];
}

const ORDER: readonly ConversationGroupLabel[] = ["Today", "Yesterday", "Previous 7 days", "Older"];

/** Local-midnight timestamp of `date`, so buckets follow calendar days. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const DAY_MS = 86_400_000;

/**
 * Which bucket a conversation belongs to, measured in whole calendar days.
 *
 * Elapsed hours would put 23:30 yesterday and 00:30 today in the same bucket,
 * which is not what "Yesterday" means to anyone reading a sidebar.
 */
export function bucketFor(updatedAt: string, now: Date): ConversationGroupLabel {
  const then = new Date(updatedAt);
  // An unparseable timestamp must not throw the whole sidebar away; the row is
  // still real and still clickable, it just has no reliable age.
  if (Number.isNaN(then.getTime())) return "Older";

  const days = Math.round((startOfDay(now) - startOfDay(then)) / DAY_MS);
  // Negative = a clock ahead of ours. Still "now" as far as the user is
  // concerned; a future-dated row filed under "Older" would look lost.
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days <= 7) return "Previous 7 days";
  return "Older";
}

/**
 * Bucket conversations by age, newest first, dropping empty groups.
 *
 * `now` is a parameter so the caller — and the tests — decide what "today" is.
 */
export function groupConversations(
  conversations: readonly ConversationSummary[],
  now: Date = new Date(),
): ConversationGroup[] {
  const buckets = new Map<ConversationGroupLabel, ConversationSummary[]>();

  // NaN from an unparseable date would make the comparator inconsistent and the
  // sort order arbitrary; those rows sort last instead.
  const time = (value: string): number => {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  const sorted = [...conversations].sort((a, b) => time(b.updated_at) - time(a.updated_at));

  for (const conversation of sorted) {
    const label = bucketFor(conversation.updated_at, now);
    const existing = buckets.get(label);
    if (existing) existing.push(conversation);
    else buckets.set(label, [conversation]);
  }

  return ORDER.filter((label) => buckets.has(label)).map((label) => ({
    label,
    items: buckets.get(label) ?? [],
  }));
}
