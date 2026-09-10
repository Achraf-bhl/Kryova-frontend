import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listProjects = vi.fn();
const listGeometry = vi.fn();
const listSimulations = vi.fn();

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return {
    ...actual,
    api: { ...actual.api, listProjects, listGeometry, listSimulations },
  };
});

const { FirstRunChecklist } = await import("./first-run");

/**
 * The claim under test is that **the checklist cannot lie about progress**.
 *
 * It has no stored flag by design. A checklist that ticks from "seen the
 * onboarding" can be entirely ticked by somebody who has done none of it — it
 * tells a stuck user they are finished — and it can be dismissed by somebody
 * who is still stuck, leaving nothing on screen about it. Deriving every tick
 * from what the account contains is what makes both impossible.
 */

function page<T>(items: T[]) {
  return { items, total: items.length, page: 1, page_size: 20 };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FirstRunChecklist", () => {
  it("shows all three steps undone for a brand-new account", async () => {
    listProjects.mockResolvedValue(page([]));

    render(<FirstRunChecklist />);

    expect(await screen.findByText("Create a project")).toBeInTheDocument();
    expect(screen.getByText("Upload a CAD file")).toBeInTheDocument();
    expect(screen.getByText("Run a linear-static solve")).toBeInTheDocument();
    // Nothing further is fetched: there is no project to look inside.
    expect(listGeometry).not.toHaveBeenCalled();
  });

  it("ticks a step only when the account really contains the thing", async () => {
    listProjects.mockResolvedValue(page([{ id: "p1", name: "Bracket" }]));
    listGeometry.mockResolvedValue(page([{ id: "g1" }]));
    listSimulations.mockResolvedValue(page([]));

    render(<FirstRunChecklist />);

    await waitFor(() => expect(screen.getByText("Create a project")).toHaveClass("line-through"));
    expect(screen.getByText("Upload a CAD file")).toHaveClass("line-through");
    expect(screen.getByText("Run a linear-static solve")).not.toHaveClass("line-through");
  });

  it("does not count a queued or failed run as a first run", async () => {
    // Ticking on "started" would tell somebody they were finished at the exact
    // moment they were not -- and a job that later fails is not a completed
    // first run by any reading.
    listProjects.mockResolvedValue(page([{ id: "p1" }]));
    listGeometry.mockResolvedValue(page([{ id: "g1" }]));
    listSimulations.mockResolvedValue(
      page([{ id: "s1", status: "queued" }, { id: "s2", status: "failed" }]),
    );

    render(<FirstRunChecklist />);

    expect(await screen.findByText("Run a linear-static solve")).toBeInTheDocument();
  });

  it("disappears once there is a succeeded run, with nothing to dismiss", async () => {
    listProjects.mockResolvedValue(page([{ id: "p1" }]));
    listGeometry.mockResolvedValue(page([{ id: "g1" }]));
    listSimulations.mockResolvedValue(page([{ id: "s1", status: "succeeded" }]));

    const { container } = render(<FirstRunChecklist />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByRole("button", { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it("renders nothing rather than an error when it cannot read progress", async () => {
    // An aid, not the product. A failure to read it must not put an error
    // banner over a project list that works perfectly well.
    listProjects.mockRejectedValue(new Error("offline"));

    const { container } = render(<FirstRunChecklist />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("points the call to action at the next undone step only", async () => {
    listProjects.mockResolvedValue(page([{ id: "p1" }]));
    listGeometry.mockResolvedValue(page([]));
    listSimulations.mockResolvedValue(page([]));

    render(<FirstRunChecklist />);

    // One link, on "upload" -- not three competing calls to action, and not one
    // on a step that cannot be done yet.
    await waitFor(() => expect(screen.getByRole("link", { name: "Upload" })).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Set up a run" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New project" })).not.toBeInTheDocument();
  });
});
