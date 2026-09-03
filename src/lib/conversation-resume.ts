import type { ConversationResume, UnfinishedOperation } from "@/types/conversation";

/**
 * Deciding what to tell someone reopening a conversation.
 *
 * Pure, and in `lib/` for the same reason the transcript rehydration is: it is
 * the part with rules in it, so it is the part worth testing without a browser.
 *
 * The rule it encodes is restraint. A banner on every conversation is furniture
 * — read once, then never again — so this returns nothing unless there is
 * something a returning reader could not already see. Two things qualify:
 *
 * - **Time has passed.** Coming back after a week is a different act from
 *   sending a second message, and the transcript above looks identical in both
 *   cases. Nothing else on the page says which one this is.
 * - **Something was left broken.** The transcript shows it if you scroll far
 *   enough; the part on screen does not show it at all, because a feature that
 *   failed to build is a feature that is not there. This is the one thing
 *   neither the chat nor the model's summary reliably carries.
 */

/**
 * Below this, reopening is the same sitting rather than a return, and the
 * transcript already reads as continuous. Half an hour: long enough that a
 * coffee does not trigger a banner, short enough that "this morning" does.
 */
export const RESUME_GAP_MS = 30 * 60 * 1000;

export interface ResumeNotice {
  /** One line: how long it has been, and how much work is behind this. */
  headline: string;
  /** Loose ends, already ordered oldest first by the backend. */
  unfinished: UnfinishedOperation[];
}

export function resumeNotice(
  resume: ConversationResume | null | undefined,
  now: number = Date.now(),
): ResumeNotice | null {
  if (!resume || resume.operations === 0) return null;

  const since = elapsedSince(resume.last_activity_at, now);
  const returning = since !== null && since >= RESUME_GAP_MS;
  const unfinished = resume.unfinished ?? [];
  if (!returning && unfinished.length === 0) return null;

  const count = `${resume.operations} CATIA ${resume.operations === 1 ? "operation" : "operations"}`;
  const headline = returning
    ? `Picked up ${describeGap(since!)} later — ${count} so far`
    : `${count} so far`;

  return { headline, unfinished };
}

/**
 * Milliseconds since an ISO timestamp, or null if there isn't a usable one.
 *
 * Null rather than 0 for an unparseable value: a missing timestamp must read as
 * "cannot say", never as "just now", which would suppress the notice on exactly
 * the conversations whose record is thinnest.
 */
function elapsedSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  // A clock skewed the other way is not worth arithmetic; it is worth not
  // rendering a negative gap.
  return Math.max(0, now - at);
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Coarse on purpose — the reader needs "yesterday", not "19h 42m". */
function describeGap(elapsed: number): string {
  if (elapsed >= DAY_MS) return plural(Math.floor(elapsed / DAY_MS), "day");
  if (elapsed >= HOUR_MS) return plural(Math.floor(elapsed / HOUR_MS), "hour");
  return plural(Math.floor(elapsed / (60 * 1000)), "minute");
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}
