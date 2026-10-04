import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HealthCheckResult } from "@/lib/system";

import { CopyDiagnostics } from "./copy-diagnostics";

/**
 * "Copy diagnostics" on the setup page (ROAD_TO_10 4.8): the button must hand over a report in
 * every case — logs read, logs absent, log request failed, clipboard refused — because the
 * point of it is that nobody has to go and find a folder.
 */

const mockFetch = vi.fn();
const writeText = vi.fn();

const checks: HealthCheckResult[] = [
  {
    prerequisite: {
      id: "api",
      label: "Kryova API server",
      description: "",
      check: async () => false,
      installHint: "",
      installUrl: "",
    },
    ok: false,
    error: "The API server is not reachable.",
  },
];

const SERVER = {
  generated_at: "2026-10-05T12:00:00.000Z",
  node: "v24.1.0",
  platform: "win32",
  arch: "x64",
  logs: [
    {
      name: "backend.log",
      bytes: 40,
      modified: "2026-10-05T11:59:00.000Z",
      truncated: false,
      tail: "ValueError: boom\n",
    },
  ],
  unavailable: [],
};

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
});

afterEach(() => {
  mockFetch.mockReset();
});

async function press() {
  const person = userEvent.setup();
  // After `setup()`, which installs its own clipboard stub over whatever was there.
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  render(<CopyDiagnostics checks={checks} platform="windows" />);
  await person.click(screen.getByRole("button", { name: "Copy diagnostics" }));
}

describe("CopyDiagnostics", () => {
  it("copies the failed checks together with the log tails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => SERVER });

    await press();

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const report = writeText.mock.calls[0][0] as string;
    expect(report).toContain("[FAILED] Kryova API server -- The API server is not reachable.");
    expect(report).toContain("ValueError: boom");
    expect(await screen.findByRole("status")).toHaveTextContent(/Copied/);
  });

  it("asks the same-origin route and never caches the answer", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => SERVER });

    await press();

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledWith("/api/diagnostics", { cache: "no-store" });
  });

  it("still copies the checks, and says logs are not kept, when this is not the desktop app", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });

    await press();

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const report = writeText.mock.calls[0][0] as string;
    expect(report).toContain("Logs: not collected. Only the desktop app keeps logs for this report.");
    expect(report).toContain("[FAILED] Kryova API server");
  });

  it("says why when the log request failed, and still copies what it has", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

    await press();

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain("Logs: could not be collected (HTTP 500).");
  });

  it("says why when the request itself threw", async () => {
    mockFetch.mockRejectedValueOnce(new Error("socket hang up"));

    await press();

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain("could not be collected (socket hang up)");
  });

  it("shows the report to select by hand when the clipboard is refused", async () => {
    writeText.mockRejectedValueOnce(new Error("not allowed"));
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => SERVER });

    await press();

    const box = await screen.findByRole("textbox", { name: "Diagnostics report" });
    expect((box as HTMLTextAreaElement).value).toContain("ValueError: boom");
    expect(screen.getByRole("status")).toHaveTextContent(/clipboard was not available/i);
    expect(screen.queryByText(/Copied/)).not.toBeInTheDocument();
  });
});
