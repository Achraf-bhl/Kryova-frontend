import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ServiceStatus } from "@/types/api";

const serviceStatus = vi.fn();

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, api: { ...actual.api, serviceStatus } };
});

const { StatusBoard } = await import("./status-board");

/**
 * The case a status page has to get right and most get worst: **the status page
 * itself cannot be reached.**
 *
 * A spinner forever, or a cheerful green panel rendered from stale state, both
 * mislead at the exact moment somebody is trying to find out whether it is them
 * or us. The honest reading is "we cannot tell you", and it can point at the one
 * thing it knows for certain is not answering.
 */

function status(overrides: Partial<ServiceStatus> = {}): ServiceStatus {
  return {
    state: "operational",
    summary: "Kryova is operating normally.",
    notice: null,
    announcements: [],
    history: [],
    history_days: 90,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("StatusBoard", () => {
  it("says it cannot tell you, rather than that everything is fine", async () => {
    serviceStatus.mockRejectedValue(new Error("network"));

    render(<StatusBoard />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/cannot reach Kryova/i);
    // And it names the thing it actually knows is down.
    expect(alert).toHaveTextContent(/the API/i);
    expect(screen.queryByText(/operating normally/i)).not.toBeInTheDocument();
  });

  it("reports the operating state with its summary", async () => {
    serviceStatus.mockResolvedValue(status());

    render(<StatusBoard />);

    expect(await screen.findByText("Kryova is operating normally.")).toBeInTheDocument();
  });

  it("shows maintenance in amber rather than red", async () => {
    // Read-only for maintenance is the product working as designed — reads and
    // navigation keep going. Red would teach people it is an outage.
    serviceStatus.mockResolvedValue(
      status({
        state: "maintenance",
        summary: "Kryova is read-only for maintenance. Reads and navigation work.",
        notice: "Back at 14:00 UTC.",
      }),
    );

    render(<StatusBoard />);

    const line = await screen.findByText(/read-only for maintenance/);
    expect(line).toHaveClass("text-warning");
    expect(screen.getByText("Back at 14:00 UTC.")).toBeInTheDocument();
  });

  it("says plainly when there has been no maintenance", async () => {
    // An empty history is a fact worth stating. A blank space reads like a page
    // that failed to load, which on a status page is the wrong impression.
    serviceStatus.mockResolvedValue(status());

    render(<StatusBoard />);

    expect(await screen.findByText(/No maintenance windows in that period/)).toBeInTheDocument();
  });

  it("says an incident is ongoing rather than showing an empty duration", async () => {
    serviceStatus.mockResolvedValue(
      status({
        state: "degraded",
        summary: "Kryova is degraded. Some work may fail or be slow.",
        history: [
          {
            started_at: "2026-09-10T09:00:00Z",
            ended_at: null,
            minutes: null,
            message: "Investigating slow solves.",
            ongoing: true,
          },
        ],
      }),
    );

    render(<StatusBoard />);

    expect(await screen.findByText("Investigating slow solves.")).toBeInTheDocument();
    expect(screen.getByText(/ongoing/)).toBeInTheDocument();
  });

  it("reports a finished window with how long it took", async () => {
    serviceStatus.mockResolvedValue(
      status({
        history: [
          {
            started_at: "2026-09-08T09:00:00Z",
            ended_at: "2026-09-08T09:42:00Z",
            minutes: 42,
            message: "Planned upgrade.",
            ongoing: false,
          },
        ],
      }),
    );

    render(<StatusBoard />);

    expect(await screen.findByText(/42 min/)).toBeInTheDocument();
  });
});
