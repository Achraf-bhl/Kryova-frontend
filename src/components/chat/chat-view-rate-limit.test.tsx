import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentEvent } from "@/lib/agent-stream";

/**
 * A rate-limited send, through the real ChatView and chat hook (ROAD_TO_10 3.2): the person is
 * told how long to wait and the wait counts down, and nothing tries to "rejoin" a turn that
 * never started. Only the network edge is replaced.
 */

const { streamAgent, resumeAgent } = vi.hoisted(() => ({
  streamAgent: vi.fn<
    (payload: unknown, onEvent: (event: AgentEvent) => void, signal?: AbortSignal) => Promise<void>
  >(),
  resumeAgent: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/agent-stream", () => ({
  streamAgent: (payload: unknown, onEvent: (event: AgentEvent) => void, signal?: AbortSignal) =>
    streamAgent(payload, onEvent, signal),
  resumeAgent,
}));

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
const { RateLimitedError } = await import("@/lib/rate-limit");

const user = { fullName: "Aziz Bahloul", email: "aziz@example.com" };

function renderChat() {
  return render(
    <ChatView
      {...user}
      conversationId="conv-1"
      title="Plate"
      initialTurns={[
        { id: "m-0", sequence: 0, role: "user", content: "build a plate" },
        { id: "m-1", sequence: 1, role: "assistant", content: "Built.", branchable: true },
      ]}
    />,
  );
}

async function send(text: string) {
  const person = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await person.type(screen.getByRole("textbox", { name: /message the kryova agent/i }), text);
  await person.click(screen.getByRole("button", { name: "Send message" }));
}

beforeEach(() => {
  streamAgent.mockReset();
  resumeAgent.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
  return () => {
    vi.useRealTimers();
  };
});

describe("ChatView when the send is rate-limited", () => {
  it("says when sending is allowed again and counts down to it", async () => {
    streamAgent.mockRejectedValueOnce(
      new RateLimitedError("Too many requests. You can send again in 12 s.", 12),
    );
    renderChat();

    await send("how heavy is it?");

    expect(await screen.findByRole("status")).toHaveTextContent("You can send again in 12 s.");
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("You can send again in 7 s.");
  });

  it("does not try to rejoin a turn that never started", async () => {
    // The resume path is for a connection that dropped under a running turn. A 429 means the
    // server refused at the door, and a GET to "resume" would replay what was already seen.
    streamAgent.mockRejectedValueOnce(
      new RateLimitedError("Too many requests. You can send again in 12 s.", 12),
    );
    renderChat();

    await send("how heavy is it?");

    await screen.findByRole("status");
    expect(resumeAgent).not.toHaveBeenCalled();
  });

  it("shows the refusal in the transcript in the server's words", async () => {
    streamAgent.mockRejectedValueOnce(
      new RateLimitedError("Too many requests. You can send again in 12 s.", 12),
    );
    renderChat();

    await send("how heavy is it?");

    expect(await screen.findAllByText(/Too many requests\. You can send again in 12 s\./)).not.toHaveLength(0);
  });

  it("shows no countdown when the server named no wait", async () => {
    streamAgent.mockRejectedValueOnce(new RateLimitedError("Too many requests.", null));
    renderChat();

    await send("how heavy is it?");

    await waitFor(() => expect(streamAgent).toHaveBeenCalled());
    await screen.findAllByText("Too many requests.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("takes the countdown away once the person sends again", async () => {
    streamAgent
      .mockRejectedValueOnce(new RateLimitedError("Too many requests. You can send again in 12 s.", 12))
      .mockImplementationOnce(async () => {});
    renderChat();
    await send("how heavy is it?");
    await screen.findByRole("status");

    await send(" and the mass?");

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });
});
