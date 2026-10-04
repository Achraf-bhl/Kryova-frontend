import { describe, expect, it } from "vitest";

import type { ServerDiagnostics } from "./diagnostics";
import { formatReport, type ReportInput } from "./diagnostics-report";

/**
 * The block somebody pastes into a bug report (ROAD_TO_10 4.8). A source that could not be read
 * must say so: a report with no backend section reads as "the backend logged nothing".
 */

const server: ServerDiagnostics = {
  generated_at: "2026-10-05T12:00:00.000Z",
  node: "v24.1.0",
  platform: "win32",
  arch: "x64",
  logs: [
    {
      name: "backend.log",
      bytes: 90_000,
      modified: "2026-10-05T11:59:00.000Z",
      truncated: true,
      tail: "Traceback (most recent call last):\nValueError: boom\n",
    },
    { name: "backend.1.log", bytes: 0, modified: "2026-10-04T08:00:00.000Z", truncated: false, tail: "" },
  ],
  unavailable: [{ name: "frontend.log", reason: "not present" }],
};

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    generatedAt: "2026-10-05T12:00:05.000Z",
    platform: "windows",
    userAgent: "Mozilla/5.0 (Windows NT 10.0) Edg/130",
    apiUrl: "http://127.0.0.1:8000/api/v1",
    checks: [
      { id: "browser", label: "Modern browser", ok: true },
      { id: "api", label: "Kryova API server", ok: false, error: "The API server is not reachable." },
    ],
    server,
    ...overrides,
  };
}

describe("formatReport", () => {
  it("states each check and whether it failed, with the reason", () => {
    const text = formatReport(input());

    expect(text).toContain("[ok] Modern browser");
    expect(text).toContain("[FAILED] Kryova API server -- The API server is not reachable.");
  });

  it("carries where it ran: platform, browser and the API it was pointed at", () => {
    const text = formatReport(input());

    expect(text).toContain("Platform: windows");
    expect(text).toContain("Edg/130");
    expect(text).toContain("API: http://127.0.0.1:8000/api/v1");
  });

  it("puts each log under its own heading and says when it shows only the end", () => {
    const text = formatReport(input());

    expect(text).toContain("--- backend.log (90000 bytes, modified 2026-10-05T11:59:00.000Z, showing the end)");
    expect(text).toContain("ValueError: boom");
    expect(text).toContain("--- backend.1.log (0 bytes, modified 2026-10-04T08:00:00.000Z)");
    expect(text).toContain("(empty)");
  });

  it("names a log that was missing instead of leaving it out", () => {
    expect(formatReport(input())).toContain("--- frontend.log: not present");
  });

  it("says logs were not collected, not that there were none, when this is not the desktop app", () => {
    const text = formatReport(input({ server: null }));

    expect(text).toContain("Logs: not collected. Only the desktop app keeps logs for this report.");
    expect(text).not.toContain("--- backend.log");
  });

  it("says why when the log request itself failed", () => {
    const text = formatReport(input({ server: { error: "HTTP 500" } }));

    expect(text).toContain("Logs: could not be collected (HTTP 500).");
  });
});
