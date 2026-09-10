import { describe, expect, it } from "vitest";

import { formatBytes, formatDuration, relativeTime, statusColor } from "./format";

describe("relativeTime", () => {
  const now = new Date("2026-09-10T12:00:00Z");
  const ago = (seconds: number) =>
    relativeTime(new Date(now.getTime() - seconds * 1000).toISOString(), now);

  it("reads recent activity as just now", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(44)).toBe("just now");
  });

  it("crosses into minutes without going straight to two", () => {
    // A session last used 90 seconds ago reading "2 minutes ago" is the kind of
    // small wrongness that makes a device list feel untrustworthy.
    expect(ago(60)).toBe("a minute ago");
    expect(ago(89)).toBe("a minute ago");
    expect(ago(300)).toBe("5 minutes ago");
  });

  it("uses hours, days, months and years as the gap grows", () => {
    expect(ago(3600)).toBe("an hour ago");
    expect(ago(3600 * 5)).toBe("5 hours ago");
    expect(ago(86400)).toBe("yesterday");
    expect(ago(86400 * 5)).toBe("5 days ago");
    expect(ago(86400 * 40)).toBe("a month ago");
    expect(ago(86400 * 200)).toBe("7 months ago");
    expect(ago(86400 * 400)).toBe("a year ago");
  });

  it("treats a timestamp in the future as now rather than as negative time", () => {
    // Clock skew between a server row and the reader's browser is ordinary.
    // "in -3 minutes" is not.
    expect(relativeTime(new Date(now.getTime() + 60_000).toISOString(), now)).toBe("just now");
  });

  it("says so rather than printing NaN when the timestamp is unreadable", () => {
    expect(relativeTime("not a date", now)).toBe("at an unknown time");
  });
});

describe("the existing formatters still hold", () => {
  it("formats bytes at each threshold", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("formats sub-second durations in milliseconds", () => {
    expect(formatDuration(0.25)).toBe("250 ms");
    expect(formatDuration(3)).toBe("3.00 s");
  });

  it("matches the API's lowercase status spelling", () => {
    expect(statusColor("succeeded")).toBe("text-success");
    expect(statusColor("SUCCEEDED")).toBe("text-muted");
  });
});
