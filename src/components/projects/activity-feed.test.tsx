import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api-client";
import type { ActivityEntry } from "@/types/api";

import { ActivityFeed } from "./activity-feed";

function entry(over: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    at: new Date().toISOString(),
    kind: "geometry.uploaded",
    summary: "Added bracket.step as geometry version 1.",
    actor_kind: "unknown",
    actor_user_id: null,
    actor_email: null,
    target_type: "geometry_version",
    target_id: "g1",
    ...over,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("ActivityFeed", () => {
  it("does not credit a row that records no author to anyone", async () => {
    vi.spyOn(api, "projectActivity").mockResolvedValue({ items: [entry()], next_before: null });
    render(<ActivityFeed projectId="p-1" currentUserId="u-1" />);

    expect(await screen.findByText(/Added bracket.step/)).toBeInTheDocument();
    expect(screen.getByText("Someone")).toBeInTheDocument();
  });

  it("says You for the reader and The agent for the agent", async () => {
    vi.spyOn(api, "projectActivity").mockResolvedValue({
      items: [
        entry({
          kind: "design.revision",
          target_id: "d1",
          summary: "Changed 'Bracket' to revision 2.",
          actor_kind: "user",
          actor_user_id: "u-1",
          actor_email: "me@shop.dev",
        }),
        entry({
          kind: "design.revision",
          target_id: "d2",
          summary: "Changed 'Plate' to revision 3.",
          actor_kind: "agent",
        }),
      ],
      next_before: null,
    });
    render(<ActivityFeed projectId="p-1" currentUserId="u-1" />);

    expect(await screen.findByText("You")).toBeInTheDocument();
    expect(screen.getByText("The agent")).toBeInTheDocument();
  });

  it("says so when nothing has happened", async () => {
    vi.spyOn(api, "projectActivity").mockResolvedValue({ items: [], next_before: null });
    render(<ActivityFeed projectId="p-1" currentUserId={null} />);
    expect(await screen.findByText("Nothing has happened here yet.")).toBeInTheDocument();
  });

  it("follows the cursor for earlier entries and then stops offering more", async () => {
    const read = vi
      .spyOn(api, "projectActivity")
      .mockResolvedValueOnce({
        items: [entry({ target_id: "a", at: "2026-10-05T10:00:00Z" })],
        next_before: "2026-10-05T10:00:00Z",
      })
      .mockResolvedValueOnce({
        items: [entry({ target_id: "b", at: "2026-10-04T10:00:00Z", summary: "Older thing." })],
        next_before: null,
      });
    render(<ActivityFeed projectId="p-1" currentUserId={null} />);

    await userEvent.click(await screen.findByRole("button", { name: "Show earlier" }));

    expect(await screen.findByText(/Older thing/)).toBeInTheDocument();
    expect(read).toHaveBeenLastCalledWith("p-1", "2026-10-05T10:00:00Z");
    expect(screen.queryByRole("button", { name: "Show earlier" })).not.toBeInTheDocument();
  });

  it("shows a failure as words", async () => {
    vi.spyOn(api, "projectActivity").mockRejectedValue(new ApiError(404, "Not found"));
    render(<ActivityFeed projectId="p-1" currentUserId={null} />);
    expect(await screen.findByText("Not found")).toBeInTheDocument();
  });
});
