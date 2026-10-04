import { describe, expect, it } from "vitest";

import { formatWait, rateLimitMessage, retryAfterSeconds } from "./rate-limit";

/**
 * What a 429 says to a person (ROAD_TO_10 3.2). The one rule under all of it: a wait is only
 * stated when the server named one, because a number invented here is a time nobody measured.
 */

function headers(value?: string): Headers {
  const h = new Headers();
  if (value !== undefined) h.set("Retry-After", value);
  return h;
}

describe("retryAfterSeconds", () => {
  it("reads delay-seconds", () => {
    expect(retryAfterSeconds(headers("12"))).toBe(12);
    expect(retryAfterSeconds(headers("  60 "))).toBe(60);
    expect(retryAfterSeconds(headers("0"))).toBe(0);
  });

  it("reads an HTTP date as the seconds until it, rounded up", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(retryAfterSeconds(headers("Mon, 05 Oct 2026 12:00:12 GMT"), now)).toBe(12);
    expect(retryAfterSeconds(headers("Mon, 05 Oct 2026 12:00:00 GMT"), now + 400)).toBe(0);
    // Half a second left is one second to wait, never zero.
    expect(retryAfterSeconds(headers("Mon, 05 Oct 2026 12:00:12 GMT"), now + 11_500)).toBe(1);
  });

  it("is null when the header is absent or is not a wait", () => {
    expect(retryAfterSeconds(headers())).toBeNull();
    expect(retryAfterSeconds(headers("soon"))).toBeNull();
    expect(retryAfterSeconds(headers("-5"))).toBeNull();
    expect(retryAfterSeconds(headers("1.5"))).toBeNull();
    expect(retryAfterSeconds(headers(""))).toBeNull();
  });
});

describe("formatWait", () => {
  it.each([
    [0, "0 s"],
    [12, "12 s"],
    [59, "59 s"],
    [60, "1 min"],
    [65, "1 min 5 s"],
    [120, "2 min"],
    // 3599.2 s rounds up to 3600; there is no hour form, so it reads in minutes.
    [3599.2, "60 min"],
  ])("%s seconds reads %s", (seconds, expected) => {
    expect(formatWait(seconds)).toBe(expected);
  });

  it("never reads a negative wait", () => {
    expect(formatWait(-4)).toBe("0 s");
  });
});

describe("rateLimitMessage", () => {
  it("states the server's sentence and when to come back", () => {
    expect(rateLimitMessage("Too many requests.", 12)).toBe(
      "Too many requests. You can try again in 12 s.",
    );
  });

  it("says send in the chat", () => {
    expect(rateLimitMessage("Too many requests.", 12, "send")).toBe(
      "Too many requests. You can send again in 12 s.",
    );
  });

  it("states no wait when the server named none", () => {
    // "You already have three runs going" resolves when one finishes, not when a clock does.
    expect(rateLimitMessage("You already have 3 simulation(s) queued or running.", null)).toBe(
      "You already have 3 simulation(s) queued or running.",
    );
  });

  it("says now when the wait is already over", () => {
    expect(rateLimitMessage("Too many requests.", 0, "send")).toBe(
      "Too many requests. You can send again now.",
    );
  });

  it("falls back to a plain sentence when the server said nothing", () => {
    expect(rateLimitMessage(undefined, 5)).toBe("Too many requests. You can try again in 5 s.");
    expect(rateLimitMessage("   ", null)).toBe("Too many requests.");
  });
});
