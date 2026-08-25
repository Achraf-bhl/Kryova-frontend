import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, statusColor } from "./format";

describe("formatBytes", () => {
  it("formats bytes", () => {
    expect(formatBytes(500)).toBe("500 B");
  });
  it("formats kilobytes", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
  it("formats megabytes", () => {
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(0.05)).toBe("50 ms");
  });
  it("formats seconds", () => {
    expect(formatDuration(1.234)).toBe("1.23 s");
  });
});

describe("statusColor", () => {
  it("maps succeeded to success colour", () => {
    expect(statusColor("SUCCEEDED")).toBe("text-success");
  });
  it("maps failed to danger colour", () => {
    expect(statusColor("FAILED")).toBe("text-danger");
  });
  it("defaults to muted for queued", () => {
    expect(statusColor("QUEUED")).toBe("text-muted");
  });
});
