import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformBanner } from "./platform-banner";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  mockFetch.mockReset();
  vi.useRealTimers();
});

function state(body: Partial<Record<string, unknown>>) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ flags: {}, announcements: [], maintenance: null, ...body }),
  });
}

describe("PlatformBanner", () => {
  it("renders nothing when there is nothing to say", async () => {
    state({});
    const { container } = render(<PlatformBanner />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the maintenance notice", async () => {
    state({ maintenance: { message: "Back at 14:00.", expected_end_at: null } });
    render(<PlatformBanner />);
    expect(await screen.findByText("Back at 14:00.")).toBeInTheDocument();
    expect(screen.getByText(/read-only right now/i)).toBeInTheDocument();
  });

  it("cannot dismiss the maintenance notice", async () => {
    // It is the one that explains why the thing the user just tried did not
    // work, so it stays until the window ends.
    state({ maintenance: { message: "Back at 14:00.", expected_end_at: null } });
    render(<PlatformBanner />);
    await screen.findByText("Back at 14:00.");
    expect(screen.queryByRole("button", { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it("shows an announcement and lets it be dismissed", async () => {
    const user = userEvent.setup();
    state({
      announcements: [
        {
          id: "a1",
          message: "Maintenance on Sunday.",
          level: "warning",
          starts_at: "2026-09-01T00:00:00Z",
          ends_at: null,
          withdrawn_at: null,
        },
      ],
    });
    render(<PlatformBanner />);

    await screen.findByText("Maintenance on Sunday.");
    await user.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(screen.queryByText("Maintenance on Sunday.")).not.toBeInTheDocument();
  });

  it("stays silent when the request fails", async () => {
    // The banner is furniture. A user whose network hiccups should not get an
    // error about the banner system on top of whatever else is wrong.
    mockFetch.mockRejectedValue(new Error("offline"));
    const { container } = render(<PlatformBanner />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
