import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationPage, ConversationSummary } from "@/types/conversation";

/**
 * The sidebar's search and pins (ROAD_TO_10 2.6). The server decides what matches —
 * `tests/test_conversation_search_pin.py` covers that. What is checked here is what
 * the sidebar does with it: when it asks, what it shows while waiting, and that a
 * slow answer to an old query never replaces a fast answer to the new one.
 */

const { listConversations, setConversationPinned } = vi.hoisted(() => ({
  listConversations: vi.fn(),
  setConversationPinned: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, api: { ...actual.api, listConversations, setConversationPinned } };
});

const { Sidebar } = await import("./sidebar");

const account = {
  id: "u1",
  email: "eng@kryova.dev",
  full_name: "Eng Ineer",
} as never;

const now = new Date().toISOString();

function row(id: string, title: string, extra: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    conversation_id: id,
    title,
    project_id: null,
    created_at: now,
    updated_at: now,
    message_count: 2,
    has_catia_document: false,
    prompt_tokens: 0,
    completion_tokens: 0,
    ...extra,
  };
}

function page(items: ConversationSummary[]): ConversationPage {
  return { total: items.length, page: 1, page_size: 30, items };
}

const search = () => screen.getByRole("searchbox", { name: /search conversations/i });

beforeEach(() => {
  listConversations.mockReset();
  setConversationPinned.mockReset();
  listConversations.mockResolvedValue(page([]));
});

describe("searching", () => {
  const stored = [row("a", "Motor mount"), row("b", "Bracket fillet")];

  it("filters the titles on screen at once and asks the server for nothing with one character", async () => {
    render(<Sidebar user={account} initialConversations={stored} />);

    await userEvent.type(search(), "m");

    expect(screen.getByText("Motor mount")).toBeInTheDocument();
    expect(screen.queryByText("Bracket fillet")).not.toBeInTheDocument();
    // The server refuses a one-character search, so the box does not send one.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(listConversations).not.toHaveBeenCalled();
  });

  it("asks the server from two characters, once typing pauses, and shows what it found", async () => {
    listConversations.mockResolvedValue(
      page([row("c", "Untitled", { match: "message" })]),
    );
    render(<Sidebar user={account} initialConversations={stored} />);

    await userEvent.type(search(), "m6");

    await waitFor(() => expect(listConversations).toHaveBeenCalledWith(1, 30, "m6"));
    // One request for the whole word, not one per keystroke.
    expect(listConversations).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Untitled")).toBeInTheDocument();
    expect(screen.getByText("found in a message")).toBeInTheDocument();
    // What the server did not return is not shown, even though its title is on screen.
    expect(screen.queryByText("Motor mount")).not.toBeInTheDocument();
  });

  it("does not show the answer to a query the person has since changed", async () => {
    const pending: Array<(value: ConversationPage) => void> = [];
    listConversations.mockImplementation(
      () => new Promise<ConversationPage>((resolve) => pending.push(resolve)),
    );
    render(<Sidebar user={account} initialConversations={stored} />);

    await userEvent.type(search(), "ab");
    await waitFor(() => expect(pending).toHaveLength(1));
    await userEvent.type(search(), "c");
    await waitFor(() => expect(pending).toHaveLength(2));

    // The newer query answers first, then the older one limps in.
    pending[1](page([row("new", "Answer to abc")]));
    await screen.findByText("Answer to abc");
    pending[0](page([row("old", "Answer to ab")]));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByText("Answer to abc")).toBeInTheDocument();
    expect(screen.queryByText("Answer to ab")).not.toBeInTheDocument();
  });

  it("stops showing the last answer the moment the query moves past it", async () => {
    listConversations.mockResolvedValueOnce(page([row("old", "Answer to ab")]));
    listConversations.mockImplementation(() => new Promise<ConversationPage>(() => {}));
    render(<Sidebar user={account} initialConversations={stored} />);

    await userEvent.type(search(), "ab");
    await screen.findByText("Answer to ab");
    await userEvent.type(search(), "c");

    // Results for "ab" beside the text "abc" would be a list that does not answer the
    // box above it; the titles on screen are the honest thing to filter meanwhile.
    expect(screen.queryByText("Answer to ab")).not.toBeInTheDocument();
    expect(screen.getByText(/no chat matches “abc”/i)).toBeInTheDocument();
  });

  it("falls back to the titles on screen when the search fails", async () => {
    listConversations.mockRejectedValue(new Error("offline"));
    render(<Sidebar user={account} initialConversations={stored} />);

    await userEvent.type(search(), "mo");

    await waitFor(() => expect(listConversations).toHaveBeenCalled());
    expect(screen.getByText("Motor mount")).toBeInTheDocument();
    expect(screen.queryByText("Bracket fillet")).not.toBeInTheDocument();
  });

  it("says when nothing matches, using what was typed", async () => {
    listConversations.mockResolvedValue(page([]));
    render(<Sidebar user={account} initialConversations={stored} />);

    await userEvent.type(search(), "zzz");

    expect(await screen.findByText(/no chat matches “zzz”/i)).toBeInTheDocument();
  });

  it("goes back to everything when the box is cleared", async () => {
    listConversations.mockResolvedValue(page([row("c", "Only this")]));
    render(<Sidebar user={account} initialConversations={stored} />);

    await userEvent.type(search(), "on");
    await screen.findByText("Only this");
    await userEvent.clear(search());

    expect(await screen.findByText("Motor mount")).toBeInTheDocument();
    expect(screen.getByText("Bracket fillet")).toBeInTheDocument();
    expect(screen.queryByText("Only this")).not.toBeInTheDocument();
  });
});

describe("pinning", () => {
  it("lists pinned conversations first, under their own heading", () => {
    render(
      <Sidebar
        user={account}
        initialConversations={[row("a", "Recent"), row("b", "Old but kept", { pinned: true })]}
      />,
    );

    const headings = screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent);
    expect(headings[0]).toBe("Pinned");
    const pinned = screen.getByText("Old but kept").closest("li");
    expect(pinned).not.toBeNull();
    expect(within(pinned as HTMLElement).getByText("(pinned)")).toBeInTheDocument();
  });

  it("moves a row to Pinned once the server has kept the pin, and not before", async () => {
    let keep: (value: unknown) => void = () => {};
    setConversationPinned.mockReturnValue(new Promise((resolve) => (keep = resolve)));
    // What the re-read finds: the server's order, with the new pin on top.
    listConversations.mockResolvedValue(
      page([row("b", "Other", { pinned: true }), row("a", "Recent")]),
    );
    render(<Sidebar user={account} initialConversations={[row("a", "Recent"), row("b", "Other")]} />);

    await userEvent.click(screen.getByRole("button", { name: "Pin Other" }));

    expect(setConversationPinned).toHaveBeenCalledWith("b", true);
    expect(screen.queryByRole("heading", { name: "Pinned" })).not.toBeInTheDocument();

    keep({});
    expect(await screen.findByRole("heading", { name: "Pinned" })).toBeInTheDocument();
    // Then the list is re-read, so the order is the server's and not a guess.
    await waitFor(() => expect(listConversations).toHaveBeenCalled());
  });

  it("leaves the row where it was and says so when the pin did not save", async () => {
    setConversationPinned.mockRejectedValue(new Error("The pin did not save."));
    listConversations.mockResolvedValue(page([row("a", "Recent")]));
    render(<Sidebar user={account} initialConversations={[row("a", "Recent")]} />);

    await userEvent.click(screen.getByRole("button", { name: "Pin Recent" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The pin did not save.");
    expect(screen.queryByRole("heading", { name: "Pinned" })).not.toBeInTheDocument();
    // No re-read after a failure: nothing changed on the server to read.
    expect(listConversations).not.toHaveBeenCalled();
  });

  it("unpins from the same button, which says which it will do", async () => {
    setConversationPinned.mockResolvedValue({});
    render(
      <Sidebar user={account} initialConversations={[row("a", "Kept", { pinned: true })]} />,
    );

    const button = screen.getByRole("button", { name: "Unpin Kept" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(button);

    expect(setConversationPinned).toHaveBeenCalledWith("a", false);
  });
});

describe("branches", () => {
  it("marks a conversation that was branched from another", () => {
    render(
      <Sidebar
        user={account}
        initialConversations={[row("a", "Thicker plate", { branched_from_id: "src" })]}
      />,
    );

    expect(screen.getByText("(a branch)")).toBeInTheDocument();
  });
});
