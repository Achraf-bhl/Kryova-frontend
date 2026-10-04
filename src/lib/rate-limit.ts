/**
 * What a "too many requests" answer should say to a person (ROAD_TO_10 3.2).
 *
 * The server sends `Retry-After` on every 429 that is a matter of time, and not on the
 * ones that are not ("you already have three simulations running" resolves when one
 * finishes, not when a clock does). So a wait is only ever stated when the server gave one:
 * inventing a number here would tell somebody to come back at a moment nobody measured,
 * which is the failure the header exists to prevent.
 */

/**
 * `Retry-After` as whole seconds, or `null` when it is absent or unusable.
 *
 * Both forms the header may take are read — delay-seconds and an HTTP date — and
 * a negative, fractional-garbage or unparseable value is `null` rather than a guess.
 * A date in the past is `0`: the wait is over.
 */
export function retryAfterSeconds(headers: Headers, now: number = Date.now()): number | null {
  const raw = headers.get("retry-after");
  if (raw === null) return null;
  const value = raw.trim();
  if (/^\d+$/.test(value)) return Number(value);
  // `Date.parse` is lenient enough to read "-5" or "1.5" as a year or a day, so only a value
  // with a day or month name in it is tried as an HTTP date.
  if (!/[A-Za-z]/.test(value)) return null;
  const when = Date.parse(value);
  if (Number.isNaN(when)) return null;
  return Math.max(0, Math.ceil((when - now) / 1000));
}

/** "12 s", "1 min 5 s", "2 min": what a person reads at a glance. */
export function formatWait(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  if (whole < 60) return `${whole} s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/**
 * The server's sentence, then when to come back — or the server's sentence alone when it
 * named no time. `verb` is "send" in the chat and "try" everywhere else; both read
 * "… again in 12 s".
 */
export function rateLimitMessage(
  detail: string | undefined,
  seconds: number | null,
  verb: "send" | "try" = "try",
): string {
  const said = detail?.trim() || "Too many requests.";
  if (seconds === null) return said;
  const clause =
    seconds === 0
      ? `You can ${verb} again now.`
      : `You can ${verb} again in ${formatWait(seconds)}.`;
  return `${said} ${clause}`;
}

/** Thrown by the chat stream on a 429, carrying the wait so the composer can count down. */
export class RateLimitedError extends Error {
  retryAfterSeconds: number | null;
  constructor(message: string, retryAfterSeconds: number | null) {
    super(message);
    this.name = "RateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
