import type { AIDayUsage, AIUserAllowance } from "@/types/api";

/**
 * What the composer's meter says about cost (ROAD_TO_10 8.1).
 *
 * Pure, so every wording is a unit test. Three rules, each because the opposite is a
 * believable lie:
 *
 * 1. **An unpriced call is named beside the cost, never folded into it.** The server sums
 *    only priced calls and counts the rest; "$0.40" over a call nobody could price reads as
 *    the whole bill. So the text says "plus N unpriced call(s)".
 * 2. **A warning names what is running out.** The server's percentage is of whichever
 *    ceiling is closer and `basis` says which; "80% used" about tokens must not be read as
 *    money, so the sentence carries the word.
 * 3. **No allowance means no percentage.** `level: "unlimited"` shows no bar at all.
 */

export type AllowanceLevel = "unlimited" | "ok" | "warning" | "exhausted";

/** Micro-dollars as a short dollar string: `$0.0042`, `$1.27`, `$0` for exactly nothing. */
export function formatMicroUsd(micro: number): string {
  if (micro <= 0) return "$0";
  const dollars = micro / 1_000_000;
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  if (dollars < 10) return `$${dollars.toFixed(2)}`;
  return `$${dollars.toFixed(0)}`;
}

/** `1.2k`, `3.4M`; whole numbers below a thousand. */
export function formatTokens(count: number): string {
  if (count < 1_000) return String(Math.max(0, Math.round(count)));
  if (count < 1_000_000) return `${(count / 1_000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

function unpricedNote(unpriced: number): string {
  if (unpriced <= 0) return "";
  return ` plus ${unpriced} unpriced call${unpriced === 1 ? "" : "s"}`;
}

/** The cost of a span of usage, with the calls it could not price named. */
export function describeCost(usage: AIDayUsage): string {
  if (usage.cost_micro_usd === 0 && usage.unpriced_calls > 0) {
    return `${usage.unpriced_calls} unpriced call${usage.unpriced_calls === 1 ? "" : "s"}`;
  }
  return `${formatMicroUsd(usage.cost_micro_usd)}${unpricedNote(usage.unpriced_calls)}`;
}

export function totalTokens(usage: AIDayUsage): number {
  // `cached_prompt_tokens` is a subset of the prompt and is never added.
  return usage.prompt_tokens + usage.completion_tokens;
}

/** One line for this conversation: tokens and cost. */
export function describeConversation(usage: AIDayUsage): string {
  if (totalTokens(usage) === 0 && usage.unpriced_calls === 0) return "No model use yet";
  return `${formatTokens(totalTokens(usage))} tokens · ${describeCost(usage)}`;
}

export interface AllowanceNotice {
  level: AllowanceLevel;
  /** Null when there is nothing to say (unlimited, or comfortably inside the budget). */
  text: string | null;
}

/** What to say about today's allowance, if anything. */
export function allowanceNotice(allowance: AIUserAllowance & {
  percent?: number | null;
  level?: string;
  basis?: string | null;
}): AllowanceNotice {
  const level = (allowance.level ?? "unlimited") as AllowanceLevel;
  const percent = allowance.percent ?? null;
  if (level === "unlimited" || percent === null) return { level: "unlimited", text: null };
  const what = allowance.basis === "cost" ? "daily spending allowance" : "daily token allowance";
  if (level === "exhausted") {
    return {
      level,
      text: `Today's ${what.replace("daily ", "")} is used up — the next message will be refused until it resets (UTC midnight).`,
    };
  }
  if (level === "warning") {
    return { level, text: `${percent}% of today's ${what.replace("daily ", "")} is used.` };
  }
  return { level: "ok", text: null };
}

/** What is left today, in the unit the server's percentage was about; null if unlimited. */
export function describeRemaining(
  today: AIDayUsage,
  allowance: AIUserAllowance & { basis?: string | null },
): string | null {
  if (allowance.basis === "cost" && allowance.daily_cost_budget_micro_usd > 0) {
    const left = Math.max(0, allowance.daily_cost_budget_micro_usd - today.cost_micro_usd);
    return `${formatMicroUsd(left)} left today`;
  }
  if (allowance.basis === "tokens" && allowance.daily_token_budget > 0) {
    const left = Math.max(0, allowance.daily_token_budget - totalTokens(today));
    return `${formatTokens(left)} tokens left today`;
  }
  return null;
}
