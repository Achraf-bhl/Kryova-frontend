import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api-client";
import type { ProjectMemoryRead } from "@/types/api";

import { MemoryProposals } from "./memory-proposals";

/**
 * The agent's suggestions, waiting in the chat (ROAD_TO_10 2.7). The claim under test is
 * that a suggestion is *not* a memory: it shows nothing as kept until the server says so,
 * and it renders nothing at all when there is nothing to decide.
 */

function fact(overrides: Partial<ProjectMemoryRead> = {}): ProjectMemoryRead {
  return {
    id: "m-1",
    text: "Fasteners are ISO 4762 A2-70.",
    state: "proposed",
    author: "agent",
    author_id: null,
    conversation_id: "conv-1",
    created_at: "2026-10-05T09:00:00Z",
    confirmed_at: null,
    ...overrides,
  };
}

function listing(...items: ProjectMemoryRead[]) {
  return { items, total: items.length, page: 1, page_size: 100, limit: 40 };
}

beforeEach(() => {
  vi.spyOn(api, "listProjectMemory").mockResolvedValue(listing(fact()));
  vi.spyOn(api, "confirmProjectMemory").mockResolvedValue(fact({ state: "confirmed" }));
  vi.spyOn(api, "forgetProjectMemory").mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MemoryProposals", () => {
  it("renders nothing when only confirmed facts exist", async () => {
    // Confirmed facts are the project page's business. A box above every composer that
    // says "nothing to decide" is furniture.
    vi.spyOn(api, "listProjectMemory").mockResolvedValue(
      listing(fact({ state: "confirmed", author: "user" })),
    );
    const { container } = render(<MemoryProposals projectId="p-1" revision={0} />);

    await waitFor(() => expect(api.listProjectMemory).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the list could not be read", async () => {
    vi.spyOn(api, "listProjectMemory").mockRejectedValue(new ApiError(500, "boom"));
    const { container } = render(<MemoryProposals projectId="p-1" revision={0} />);

    await waitFor(() => expect(api.listProjectMemory).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a waiting suggestion and says the assistant has not been told it", async () => {
    render(<MemoryProposals projectId="p-1" revision={0} />);

    expect(await screen.findByText("Fasteners are ISO 4762 A2-70.")).toBeInTheDocument();
    expect(screen.getByText(/has not been told these/i)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Suggested project facts" })).toBeInTheDocument();
  });

  it("keeps a suggestion only when the server has confirmed it, then stops showing it", async () => {
    // After the confirm the server's list holds it as confirmed, so there is nothing
    // left to decide. The panel shows what the server answered, not what it hoped.
    const user = userEvent.setup();
    const reads = vi
      .spyOn(api, "listProjectMemory")
      .mockResolvedValueOnce(listing(fact()))
      .mockResolvedValue(listing(fact({ state: "confirmed" })));
    render(<MemoryProposals projectId="p-1" revision={0} />);

    await user.click(await screen.findByRole("button", { name: /^Keep:/ }));

    await waitFor(() => expect(api.confirmProjectMemory).toHaveBeenCalledWith("p-1", "m-1"));
    await waitFor(() =>
      expect(screen.queryByText("Fasteners are ISO 4762 A2-70.")).not.toBeInTheDocument(),
    );
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it("dismisses by deleting, and does not confirm", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listProjectMemory")
      .mockResolvedValueOnce(listing(fact()))
      .mockResolvedValue(listing());
    render(<MemoryProposals projectId="p-1" revision={0} />);

    await user.click(await screen.findByRole("button", { name: /^Dismiss:/ }));

    await waitFor(() => expect(api.forgetProjectMemory).toHaveBeenCalledWith("p-1", "m-1"));
    expect(api.confirmProjectMemory).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText("Fasteners are ISO 4762 A2-70.")).not.toBeInTheDocument(),
    );
  });

  it("keeps showing the suggestion and says why when the server refuses", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "confirmProjectMemory").mockRejectedValue(
      new ApiError(409, "This project already holds 40 facts, which is the most it keeps."),
    );
    render(<MemoryProposals projectId="p-1" revision={0} />);

    await user.click(await screen.findByRole("button", { name: /^Keep:/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already holds 40 facts/);
    expect(screen.getByText("Fasteners are ISO 4762 A2-70.")).toBeInTheDocument();
  });

  it("reads again when the revision moves, which is when a turn has finished", async () => {
    const { rerender } = render(<MemoryProposals projectId="p-1" revision={1} />);
    await waitFor(() => expect(api.listProjectMemory).toHaveBeenCalledTimes(1));

    rerender(<MemoryProposals projectId="p-1" revision={2} />);

    await waitFor(() => expect(api.listProjectMemory).toHaveBeenCalledTimes(2));
  });

  it("does not read again when nothing moved", async () => {
    const { rerender } = render(<MemoryProposals projectId="p-1" revision={1} />);
    await waitFor(() => expect(api.listProjectMemory).toHaveBeenCalledTimes(1));

    rerender(<MemoryProposals projectId="p-1" revision={1} />);

    // Polling would ask an unchanged list to resend itself.
    expect(api.listProjectMemory).toHaveBeenCalledTimes(1);
  });

  it("renders the sentence as text, never as markup", async () => {
    vi.spyOn(api, "listProjectMemory").mockResolvedValue(
      listing(fact({ text: "<img src=x onerror=alert(1)> units are mm" })),
    );
    const { container } = render(<MemoryProposals projectId="p-1" revision={0} />);

    expect(await screen.findByText(/units are mm/)).toHaveTextContent("<img src=x onerror=alert(1)>");
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("MemoryProposals and a slow answer", () => {
  it("ignores a late answer for a project the user has already left", async () => {
    // The first project's read is slow; the user moves to the second, which answers at
    // once. When the first finally lands it must not overwrite the second's list.
    let resolveFirst: (value: ReturnType<typeof listing>) => void = () => {};
    vi.spyOn(api, "listProjectMemory")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(listing(fact({ id: "m-2", text: "Second project's suggestion." })));
    const { rerender } = render(<MemoryProposals projectId="p-1" revision={0} />);

    rerender(<MemoryProposals projectId="p-2" revision={0} />);
    expect(await screen.findByText("Second project's suggestion.")).toBeInTheDocument();
    resolveFirst(listing(fact({ id: "m-1", text: "First project's suggestion." })));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByText("First project's suggestion.")).not.toBeInTheDocument();
    expect(screen.getByText("Second project's suggestion.")).toBeInTheDocument();
  });
});
