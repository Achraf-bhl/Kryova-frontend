import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api-client";
import type { ProjectMemoryRead } from "@/types/api";

import { ProjectMemoryPanel } from "./memory-panel";

/**
 * The project's memory on its page (ROAD_TO_10 2.7): the user's list, which they can
 * add to, reword and delete, with the assistant's suggestions kept apart and labelled
 * as not yet told.
 */

function fact(overrides: Partial<ProjectMemoryRead> = {}): ProjectMemoryRead {
  return {
    id: "m-1",
    text: "Units are mm.",
    state: "confirmed",
    author: "user",
    author_id: "u-1",
    conversation_id: null,
    created_at: "2026-10-05T09:00:00Z",
    confirmed_at: "2026-10-05T09:00:00Z",
    ...overrides,
  };
}

function listing(...items: ProjectMemoryRead[]) {
  return { items, total: items.length, page: 1, page_size: 100, limit: 40 };
}

beforeEach(() => {
  vi.spyOn(api, "listProjectMemory").mockResolvedValue(listing(fact()));
  vi.spyOn(api, "addProjectMemory").mockResolvedValue(fact({ id: "m-2" }));
  vi.spyOn(api, "editProjectMemory").mockResolvedValue(fact());
  vi.spyOn(api, "confirmProjectMemory").mockResolvedValue(fact());
  vi.spyOn(api, "forgetProjectMemory").mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProjectMemoryPanel", () => {
  it("says what a fact is for before listing any", async () => {
    render(<ProjectMemoryPanel projectId="p-1" />);

    expect(await screen.findByText("Units are mm.")).toBeInTheDocument();
    // The user must know every fact is sent to the assistant, or they will paste a paragraph.
    expect(screen.getByText(/told each one at the start of every/i)).toBeInTheDocument();
  });

  it("says how much of the limit is used, from the server's number", async () => {
    render(<ProjectMemoryPanel projectId="p-1" />);

    expect(await screen.findByText("1 of 40 facts used")).toBeInTheDocument();
  });

  it("keeps the assistant's suggestions apart and labelled as not yet told", async () => {
    vi.spyOn(api, "listProjectMemory").mockResolvedValue(
      listing(fact(), fact({ id: "m-9", text: "Bolts are A2-70.", state: "proposed", author: "agent" })),
    );
    render(<ProjectMemoryPanel projectId="p-1" />);

    const suggested = await screen.findByRole("list", { name: "Suggested facts" });
    expect(within(suggested).getByText("Bolts are A2-70.")).toBeInTheDocument();
    expect(screen.getByText(/not yet told/i)).toBeInTheDocument();
    // And they are not in the list of what is remembered, nor counted as used.
    const kept = screen.getByRole("list", { name: "Remembered facts" });
    expect(within(kept).queryByText("Bolts are A2-70.")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 40 facts used")).toBeInTheDocument();
  });

  it("adds a trimmed fact and clears the box once the server has taken it", async () => {
    const user = userEvent.setup();
    render(<ProjectMemoryPanel projectId="p-1" />);
    await screen.findByText("Units are mm.");

    await user.type(screen.getByLabelText("New project fact"), "   Drawings are ISO A3.  ");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(api.addProjectMemory).toHaveBeenCalledWith("p-1", "Drawings are ISO A3."),
    );
    await waitFor(() => expect(screen.getByLabelText("New project fact")).toHaveValue(""));
  });

  it("keeps what was typed and says why when the server refuses", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "addProjectMemory").mockRejectedValue(
      new ApiError(409, "This project already holds 40 facts. Delete one that no longer matters first."),
    );
    render(<ProjectMemoryPanel projectId="p-1" />);
    await screen.findByText("Units are mm.");

    await user.type(screen.getByLabelText("New project fact"), "One too many");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already holds 40 facts/);
    expect(screen.getByLabelText("New project fact")).toHaveValue("One too many");
  });

  it("does not offer to add an empty fact", async () => {
    render(<ProjectMemoryPanel projectId="p-1" />);
    await screen.findByText("Units are mm.");

    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("rewords a fact through the edit call", async () => {
    const user = userEvent.setup();
    render(<ProjectMemoryPanel projectId="p-1" />);

    await user.click(await screen.findByRole("button", { name: /^Edit:/ }));
    const box = screen.getByLabelText("Reword this fact");
    await user.clear(box);
    await user.type(box, "Units are mm and N.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.editProjectMemory).toHaveBeenCalledWith("p-1", "m-1", "Units are mm and N."),
    );
  });

  it("stays in the editor and says why when the reword is refused", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "editProjectMemory").mockRejectedValue(
      new ApiError(409, "The project already holds that fact."),
    );
    render(<ProjectMemoryPanel projectId="p-1" />);

    await user.click(await screen.findByRole("button", { name: /^Edit:/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already holds that fact/);
    expect(screen.getByLabelText("Reword this fact")).toBeInTheDocument();
  });

  it("deletes a fact", async () => {
    const user = userEvent.setup();
    render(<ProjectMemoryPanel projectId="p-1" />);

    await user.click(await screen.findByRole("button", { name: /^Delete:/ }));

    await waitFor(() => expect(api.forgetProjectMemory).toHaveBeenCalledWith("p-1", "m-1"));
  });

  it("keeps a suggestion through the confirm call, not the add call", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listProjectMemory").mockResolvedValue(
      listing(fact({ id: "m-9", text: "Bolts are A2-70.", state: "proposed", author: "agent" })),
    );
    render(<ProjectMemoryPanel projectId="p-1" />);

    await user.click(await screen.findByRole("button", { name: /^Keep:/ }));

    await waitFor(() => expect(api.confirmProjectMemory).toHaveBeenCalledWith("p-1", "m-9"));
    expect(api.addProjectMemory).not.toHaveBeenCalled();
  });

  it("says so, in words, when the list cannot be read", async () => {
    vi.spyOn(api, "listProjectMemory").mockRejectedValue(new ApiError(500, "The database is down."));
    render(<ProjectMemoryPanel projectId="p-1" />);

    expect(await screen.findByText("The database is down.")).toBeInTheDocument();
  });

  it("renders an empty project as empty", async () => {
    vi.spyOn(api, "listProjectMemory").mockResolvedValue(listing());
    render(<ProjectMemoryPanel projectId="p-1" />);

    expect(await screen.findByText("Nothing remembered yet.")).toBeInTheDocument();
  });
});
