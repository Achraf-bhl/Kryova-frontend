import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RateLimitNotice } from "./rate-limit-notice";

/**
 * The countdown beside the composer (ROAD_TO_10 3.2): it counts to a moment the server fixed,
 * and when the moment passes it says so rather than leaving a stale number on screen.
 */

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const NOW = Date.parse("2026-10-05T12:00:00Z");

describe("RateLimitNotice", () => {
  it("says how long is left", () => {
    render(<RateLimitNotice retryAt={NOW + 12_000} />);

    expect(screen.getByRole("status")).toHaveTextContent("You can send again in 12 s.");
  });

  it("counts down each second", () => {
    render(<RateLimitNotice retryAt={NOW + 12_000} />);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(screen.getByRole("status")).toHaveTextContent("You can send again in 7 s.");
  });

  it("says so when the moment passes, and stops ticking", () => {
    render(<RateLimitNotice retryAt={NOW + 3_000} />);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(screen.getByRole("status")).toHaveTextContent("You can send again now.");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reads minutes for a long wait", () => {
    render(<RateLimitNotice retryAt={NOW + 65_000} />);

    expect(screen.getByRole("status")).toHaveTextContent("You can send again in 1 min 5 s.");
  });

  it("is correct the instant a backgrounded tab wakes, because it counts to a moment", () => {
    render(<RateLimitNotice retryAt={NOW + 60_000} />);

    // The tab was frozen: the clock moved 45 s but no interval callback ran in between.
    act(() => {
      vi.setSystemTime(NOW + 45_000);
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.getByRole("status")).toHaveTextContent("You can send again in 14 s.");
  });

  it("does not start a timer for a moment already past", () => {
    render(<RateLimitNotice retryAt={NOW - 1_000} />);

    expect(screen.getByRole("status")).toHaveTextContent("You can send again now.");
    expect(vi.getTimerCount()).toBe(0);
  });
});
