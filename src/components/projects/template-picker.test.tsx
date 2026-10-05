import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api-client";
import type { ProjectRead, ProjectTemplate } from "@/types/api";

import { ProjectStarters } from "./template-picker";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }) }));

const template: ProjectTemplate = {
  key: "M2",
  title: "Welded frame",
  era: "I",
  kind: "assembly",
  hard: "Several parts that must agree.",
  claims: ["mass: mass_kg <= 40"],
  unproven: ["the welds are not sized"],
  seeds_a_design: false,
};

const created: ProjectRead = {
  id: "p-9",
  name: "Welded frame",
  description: "",
  owner_id: "u-1",
  organisation_id: "o-1",
  created_at: "2026-10-05T09:00:00Z",
  updated_at: "2026-10-05T09:00:00Z",
  archived_at: null,
  tags: [],
  template_key: "M2",
  starred: false,
};

beforeEach(() => push.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("ProjectStarters", () => {
  it("shows what a rung does not prove before it can be chosen", async () => {
    vi.spyOn(api, "listProjectTemplates").mockResolvedValue([template]);
    render(<ProjectStarters />);

    await userEvent.click(screen.getByRole("button", { name: "Start from a mission" }));

    expect(await screen.findByText("M2 · Welded frame")).toBeInTheDocument();
    expect(screen.getByText("Does NOT prove")).toBeInTheDocument();
    expect(screen.getByText("the welds are not sized")).toBeInTheDocument();
    expect(screen.getByText(/Starts with no design/)).toBeInTheDocument();
  });

  it("opens the project page for a rung with no design", async () => {
    vi.spyOn(api, "listProjectTemplates").mockResolvedValue([template]);
    vi.spyOn(api, "createProjectFromTemplate").mockResolvedValue({
      project: created,
      template,
      conversation_id: null,
      design_note: "product graph",
    });
    render(<ProjectStarters />);

    await userEvent.click(screen.getByRole("button", { name: "Start from a mission" }));
    await userEvent.click(await screen.findByRole("button", { name: "Start" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/projects/p-9"));
  });

  it("opens the conversation holding the design when there is one", async () => {
    vi.spyOn(api, "listProjectTemplates").mockResolvedValue([{ ...template, seeds_a_design: true }]);
    vi.spyOn(api, "createProjectFromTemplate").mockResolvedValue({
      project: created,
      template,
      conversation_id: "c-1",
      design_note: "",
    });
    render(<ProjectStarters />);

    await userEvent.click(screen.getByRole("button", { name: "Start from a mission" }));
    await userEvent.click(await screen.findByRole("button", { name: "Start" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/c/c-1"));
  });

  it("shows an import refusal in the server's words", async () => {
    vi.spyOn(api, "importProject").mockRejectedValue(
      new ApiError(422, "'geometry/v1-a.stl' does not match the hash recorded in the manifest."),
    );
    render(<ProjectStarters />);

    const file = new File(["x"], "p.kryova.zip", { type: "application/zip" });
    await userEvent.upload(screen.getByLabelText("Project archive"), file);

    expect(await screen.findByRole("alert")).toHaveTextContent(/hash recorded in the manifest/);
    expect(push).not.toHaveBeenCalled();
  });
});
