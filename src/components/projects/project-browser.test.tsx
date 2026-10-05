import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api-client";
import type { ProjectRead } from "@/types/api";

import { ProjectBrowser } from "./project-browser";

function project(over: Partial<ProjectRead> = {}): ProjectRead {
  return {
    id: "p-1",
    name: "Punch press",
    description: "stamping",
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

function page(...items: ProjectRead[]) {
  return { items, total: items.length, page: 1, page_size: 50 };
}

afterEach(() => vi.restoreAllMocks());

describe("ProjectBrowser", () => {
  it("shows the server's list without asking again until a filter is touched", () => {
    const search = vi.spyOn(api, "searchProjects").mockResolvedValue(page());
    render(<ProjectBrowser initial={[project()]} />);

    expect(screen.getByText("Punch press")).toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
  });

  it("asks the API for a search, and shows what came back", async () => {
    const search = vi
      .spyOn(api, "searchProjects")
      .mockResolvedValue(page(project({ id: "p-2", name: "Gearbox", tags: [] })));
    render(<ProjectBrowser initial={[project()]} />);

    await userEvent.type(screen.getByLabelText("Search projects"), "gear");

    expect(await screen.findByText("Gearbox")).toBeInTheDocument();
    expect(screen.queryByText("Punch press")).not.toBeInTheDocument();
    expect(search).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: "gear", starred: false, archived: "exclude" }),
    );
  });

  it("says nothing is archived rather than showing a loading state", async () => {
    vi.spyOn(api, "searchProjects").mockResolvedValue(page());
    render(<ProjectBrowser initial={[project()]} />);

    await userEvent.click(screen.getByRole("button", { name: "Archived" }));

    expect(await screen.findByText("Nothing is archived.")).toBeInTheDocument();
  });

  it("filters by a tag taken from the list", async () => {
    const search = vi.spyOn(api, "searchProjects").mockResolvedValue(page(project()));
    render(<ProjectBrowser initial={[project()]} />);

    await userEvent.click(screen.getByRole("button", { name: "press" }));

    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ tag: "press" })),
    );
  });

  it("toggles a star through the server and shows the answer", async () => {
    const star = vi.spyOn(api, "starProject").mockResolvedValue(project({ starred: true }));
    render(<ProjectBrowser initial={[project()]} />);

    await userEvent.click(screen.getByRole("button", { name: "Star Punch press" }));

    expect(star).toHaveBeenCalledWith("p-1", true);
    expect(await screen.findByRole("button", { name: "Unstar Punch press" })).toBeInTheDocument();
  });
});
