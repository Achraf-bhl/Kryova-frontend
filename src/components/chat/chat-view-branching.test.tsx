import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentEvent } from "@/lib/agent-stream";
import type { Turn } from "@/lib/conversation-transcript";

/**
 * Retry, Edit and Branch (ROAD_TO_10 2.5), driven through the real ChatView and the
 * real chat hook, with only the network edges replaced: the stream, and the three
 * conversation calls. What is under test is what the screen does with what the
 * server says — not the server, which `tests/test_conversation_branching.py` covers.
 */

// Created in the hoisted block because `vi.mock` factories run before this file's own
// top-level statements, and a factory reaching a plain `const` there reads it too early.
const { push, rewindConversation, branchConversation } = vi.hoisted(() => ({
  push: vi.fn(),
  rewindConversation: vi.fn(),
  branchConversation: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));

const streamAgent =
  vi.fn<(payload: unknown, onEvent: (event: AgentEvent) => void, signal?: AbortSignal) => Promise<void>>();
vi.mock("@/lib/agent-stream", () => ({
  streamAgent: (payload: unknown, onEvent: (event: AgentEvent) => void, signal?: AbortSignal) =>
    streamAgent(payload, onEvent, signal),
}));

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return {
    ...actual,
    api: { ...actual.api, rewindConversation, branchConversation, cancelTurn: vi.fn() },
  };
});

vi.mock("@/hooks/use-catia-status", () => ({
  useCatiaStatus: () => ({
    state: "offline" as const,
    status: null,
    detail: "",
    events: [],
    lastEvent: null,
    refresh: () => {},
  }),
}));

const { ChatView } = await import("./chat-view");
const { ApiError } = await import("@/lib/api-client");

const user = { fullName: "Aziz Bahloul", email: "aziz@example.com" };

const STORED: Turn[] = [
  { id: "m-0", sequence: 0, role: "user", content: "build a plate" },
  { id: "m-3", sequence: 3, role: "assistant", content: "The plate is built.", branchable: true },
  { id: "m-4", sequence: 4, role: "user", content: "how heavy is it?" },
  { id: "m-5", sequence: 5, role: "assistant", content: "About 0.05 kg.", branchable: true },
];

function renderStored(turns: Turn[] = STORED, extra: Record<string, unknown> = {}) {
  return render(
    <ChatView {...user} conversationId="conv-1" title="Plate" initialTurns={turns} {...extra} />,
  );
}

beforeEach(() => {
  push.mockReset();
  rewindConversation.mockReset();
  branchConversation.mockReset();
  streamAgent.mockReset();
  streamAgent.mockImplementation(async () => {});
});

describe("Retry and Edit", () => {
  it("offer themselves under the newest message the person wrote, and only there", () => {
    renderStored();

    // Two typed messages, one pair of buttons: the newest.
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
  });

  it("are not offered before the conversation exists for the server to rewind", () => {
    render(
      <ChatView
        {...user}
        initialTurns={[{ id: "u", role: "user", content: "hello" }, { id: "a", role: "assistant", content: "hi" }]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("Retry takes the message back, trims the thread, and sends the same words again", async () => {
    rewindConversation.mockResolvedValue({ message: "how heavy is it?", removed_messages: 2 });
    renderStored();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(streamAgent).toHaveBeenCalled());
    expect(rewindConversation).toHaveBeenCalledWith("conv-1");
    expect(streamAgent.mock.calls[0][0]).toMatchObject({ message: "how heavy is it?" });
    // The old answer is gone from the screen; the earlier exchange stays.
    expect(screen.queryByText("About 0.05 kg.")).not.toBeInTheDocument();
    // And the message is on screen once — the thread was trimmed *through* it, so the
    // resend is not drawn under its own old copy.
    expect(screen.getAllByText("how heavy is it?")).toHaveLength(1);
    expect(screen.getByText("The plate is built.")).toBeInTheDocument();
  });

  it("Edit takes it back and puts the words in the composer instead of sending", async () => {
    rewindConversation.mockResolvedValue({ message: "how heavy is it?", removed_messages: 2 });
    renderStored();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /message the kryova agent/i })).toHaveValue(
        "how heavy is it?",
      ),
    );
    expect(streamAgent).not.toHaveBeenCalled();
    expect(screen.queryByText("About 0.05 kg.")).not.toBeInTheDocument();
  });

  it("changes nothing on screen when the server refuses, and says why", async () => {
    const reason = "That turn changed things (catia_pocket). Branch from the answer before it instead.";
    rewindConversation.mockRejectedValue(new ApiError(409, reason));
    renderStored();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(reason);
    // Twice, because the finished answer is also read out in a live region.
    expect(screen.getAllByText("About 0.05 kg.").length).toBeGreaterThan(0);
    expect(streamAgent).not.toHaveBeenCalled();
  });

  it("turns a refusal into a one-click branch from the answer before the message", async () => {
    rewindConversation.mockRejectedValue(new ApiError(409, "That turn changed things (catia_pocket)."));
    branchConversation.mockResolvedValue({ conversation_id: "branch-1" });
    renderStored();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /branch from the answer before it/i }),
    );

    // The answer at sequence 3 is the one before "how heavy is it?" (sequence 4).
    await waitFor(() => expect(branchConversation).toHaveBeenCalledWith("conv-1", 3));
    expect(push).toHaveBeenCalledWith("/dashboard/c/branch-1");
  });

  it("does not offer that branch when the failure was the network, not a decision", async () => {
    rewindConversation.mockRejectedValue(new Error("Failed to fetch"));
    renderStored();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch");
    expect(
      screen.queryByRole("button", { name: /branch from the answer before it/i }),
    ).not.toBeInTheDocument();
  });
});

describe("Branch", () => {
  it("is offered under every stored answer the server marked, and no other", () => {
    renderStored([
      ...STORED,
      // An answer that also asked for a tool: the server did not mark it.
      { id: "m-6", sequence: 6, role: "assistant", content: "Let me cut that." },
    ]);

    expect(screen.getAllByRole("button", { name: /branch a new conversation/i })).toHaveLength(2);
  });

  it("starts at the answer it sits under and opens the new conversation", async () => {
    branchConversation.mockResolvedValue({ conversation_id: "branch-9" });
    renderStored();

    const [first] = screen.getAllByRole("button", { name: /branch a new conversation/i });
    await userEvent.click(first);

    await waitFor(() => expect(branchConversation).toHaveBeenCalledWith("conv-1", 3));
    expect(push).toHaveBeenCalledWith("/dashboard/c/branch-9");
  });

  it("is offered under a live answer only while it is the newest, and branches at the newest", async () => {
    branchConversation.mockResolvedValue({ conversation_id: "branch-2" });
    renderStored([
      { id: "u", role: "user", content: "hello" },
      { id: "live", role: "assistant", content: "hi there" },
    ]);

    await userEvent.click(screen.getByRole("button", { name: /branch a new conversation/i }));

    // No sequence is known for a live turn, so none is sent: the server's default is
    // exactly "the newest answer".
    await waitFor(() => expect(branchConversation).toHaveBeenCalledWith("conv-1", undefined));
  });

  it("says so, and stays put, when the server cannot branch", async () => {
    branchConversation.mockRejectedValue(new ApiError(422, "Message 3 is not one of the assistant's answers."));
    renderStored();

    const [first] = screen.getAllByRole("button", { name: /branch a new conversation/i });
    await userEvent.click(first);

    expect(await screen.findByRole("alert")).toHaveTextContent(/not one of the assistant's answers/i);
    expect(push).not.toHaveBeenCalled();
  });

  it("is not offered while a turn is running", async () => {
    let release: () => void = () => {};
    streamAgent.mockImplementation(
      (_payload, onEvent) =>
        new Promise<void>((resolve) => {
          release = resolve;
          onEvent({ type: "thinking", step: 1, max_steps: 20 });
        }),
    );
    renderStored();
    await userEvent.type(
      screen.getByRole("textbox", { name: /message the kryova agent/i }),
      "and the stress?",
    );
    await userEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => expect(streamAgent).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /branch a new conversation/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();

    act(() => release());
  });
});

describe("the head of a branch", () => {
  it("names where it came from and what it did not bring", () => {
    renderStored(STORED, {
      branchedFrom: { conversation_id: "src-1", title: "Plate study", at_sequence: 3 },
    });

    expect(screen.getByRole("link", { name: "Plate study" })).toHaveAttribute(
      "href",
      "/dashboard/c/src-1",
    );
    expect(screen.getByText(/the catia part was not copied/i)).toBeInTheDocument();
  });

  it("says nothing in an ordinary conversation", () => {
    renderStored();
    expect(screen.queryByLabelText(/branched from/i)).not.toBeInTheDocument();
  });
});
