import { describe, expect, it } from "vitest";

import type { OperationLatency, SiteLatency } from "@/types/api";

import {
  failureNote,
  formatMicroUsd,
  formatMillis,
  formatSeconds,
  slowestFirst,
  tailLabel,
} from "./observability";

describe("durations", () => {
  it("uses the unit a reader compares in", () => {
    expect(formatSeconds(0.85)).toBe("850 ms");
    expect(formatSeconds(4.2)).toBe("4.2 s");
    expect(formatSeconds(42)).toBe("42 s");
    expect(formatSeconds(185)).toBe("3 min 05 s");
  });

  it("does not print sixty seconds", () => {
    expect(formatSeconds(119.7)).toBe("2 min 00 s");
  });

  it("refuses to format what is not a duration", () => {
    expect(formatSeconds(Number.NaN)).toBe("—");
    expect(formatSeconds(-1)).toBe("—");
  });

  it("formats milliseconds through the same rules", () => {
    expect(formatMillis(1500)).toBe("1.5 s");
  });
});

describe("money", () => {
  it("is exact integer arithmetic until the last step", () => {
    expect(formatMicroUsd(1_234_567)).toBe("$1.23");
    expect(formatMicroUsd(1_000_000)).toBe("$1.00");
    expect(formatMicroUsd(12_345_678_900)).toBe("$12,345.68");
  });

  it("shows a real cost under a cent instead of rounding it to nothing", () => {
    expect(formatMicroUsd(5_000)).toBe("0.50¢");
    expect(formatMicroUsd(50)).toBe("0.005¢");
  });

  it("says no price rather than zero", () => {
    expect(formatMicroUsd(null)).toBe("no price");
    expect(formatMicroUsd(0)).toBe("$0.00");
  });
});

describe("tails", () => {
  it("calls a small sample's p95 the maximum", () => {
    expect(tailLabel(true)).toMatch(/max/);
    expect(tailLabel(true)).not.toBe("p95");
    expect(tailLabel(false)).toBe("p95");
  });

  it("puts the slowest tail first, with the name breaking a tie", () => {
    const site = (name: string, p95: number): SiteLatency => ({
      name,
      seen: 1,
      failures: 0,
      window_size: 1,
      median_seconds: 0,
      p95_seconds: p95,
      max_seconds: p95,
      p95_is_the_maximum: true,
    });
    expect(slowestFirst([site("b", 1), site("a", 1), site("c", 9)]).map((r) => r.name)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("orders bridge operations by p95 in milliseconds", () => {
    const op = (tool: string, p95: number): OperationLatency => ({
      tool,
      count: 1,
      failures: 0,
      median_ms: 0,
      p95_ms: p95,
      max_ms: p95,
      p95_is_the_maximum: true,
    });
    expect(slowestFirst([op("pad", 200), op("fillet", 5000)]).map((r) => r.tool)).toEqual([
      "fillet",
      "pad",
    ]);
  });
});

describe("failures", () => {
  it("says nothing when none failed", () => {
    expect(failureNote(0, 10)).toBeNull();
    expect(failureNote(3, 5000)).toBe("3 of 5,000 failed");
  });
});
