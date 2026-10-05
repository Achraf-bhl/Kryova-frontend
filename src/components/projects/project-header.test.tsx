import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api-client";
import type { ProjectRead } from "@/types/api";

import { ProjectHeader } from "./project-header";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));

function project(over: Partial<ProjectRead> = {}): ProjectRead {
  return {
    id: "p-1",
    name: "Punch press",
    description: null,
    owner_id: "u-1",
    organisation_id: "o-1",
    created_at: "2026-10-05T09:00:00Z",
    updated_at: "2026-10-05T09:00:00Z",
    archived_at: null,
    tags: ["press"],
    template_key: null,
    starred: false,
    ...over,
  };
}

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("ProjectHeader", () => {
  it("renames on the spot and shows the server's answer", async () => {
    const update = vi
      .spyOn(api, "updateProject")
      .mockResolvedValue(project({ name: "Press frame" }));
    render(<ProjectHeader project={project()} />);

    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    const field = screen.getByLabelText("Project name");
    await userEvent.clear(field);
    await userEvent.type(field, "Press frame");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(update).toHaveBeenCalledWith("p-1", { name: "Press frame" });
    expect(await screen.findByRole("heading", { name: /Press frame/ })).toBeInTheDocument();
  });

  it("archives with a sentence saying nothing was deleted", async () => {
    vi.spyOn(api, "updateProject").mockResolvedValue(
      project({ archived_at: "2026-10-05T10:00:00Z" }),
    );
    render(<ProjectHeader project={project()} />);

    await userEvent.click(screen.getByRole("button", { name: "Archive" }));

    expect(await screen.findByText(/Nothing in it was deleted/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("tells the user what a duplicate left out", async () => {
    vi.spyOn(api, "duplicateProject").mockResolvedValue({
      project: project({ id: "p-2", name: "Punch press (copy)" }),
      geometry_versions: 1,
      designs: 1,
      left_out: ["the CATIA document", "simulation results"],
    });
    render(<ProjectHeader project={project()} />);

    await userEvent.click(screen.getByRole("button", { name: "Duplicate" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/projects/p-2"));
    expect(screen.getByText(/Not copied: the CATIA document; simulation results/)).toBeInTheDocument();
  });

  it("sends tags as the list the user typed and shows the normalised result", async () => {
    const update = vi
      .spyOn(api, "updateProject")
      .mockResolvedValue(project({ tags: ["press", "frame"] }));
    render(<ProjectHeader project={project()} />);

    await userEvent.click(screen.getByRole("button", { name: "Edit tags" }));
    const field = screen.getByLabelText("Tags, separated by commas");
    await userEvent.clear(field);
    await userEvent.type(field, "Press, frame,");
    await userEvent.click(screen.getByRole("button", { name: "Save tags" }));

    expect(update).toHaveBeenCalledWith("p-1", { tags: ["Press", "frame"] });
    expect(await screen.findByText("press · frame")).toBeInTheDocument();
  });

  it("shows a refusal as words and does not change the page", async () => {
    vi.spyOn(api, "updateProject").mockRejectedValue(
      new ApiError(422, "The tag 'a;b' may use letters, digits, spaces and . _ / + - only."),
    );
    render(<ProjectHeader project={project()} />);

    await userEvent.click(screen.getByRole("button", { name: "Edit tags" }));
    await userEvent.click(screen.getByRole("button", { name: "Save tags" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/may use letters/);
    expect(screen.getByLabelText("Tags, separated by commas")).toBeInTheDocument();
  });

  it("stars and unstars through the server", async () => {
    const star = vi
      .spyOn(api, "starProject")
      .mockResolvedValue(project({ starred: true }));
    render(<ProjectHeader project={project()} />);

    await userEvent.click(screen.getByRole("button", { name: "Star" }));

    expect(star).toHaveBeenCalledWith("p-1", true);
    expect(await screen.findByRole("button", { name: "Unstar" })).toBeInTheDocument();
  });
});
