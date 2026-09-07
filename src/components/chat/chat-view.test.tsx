import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentEvent } from "@/lib/agent-stream";
import type { Turn } from "@/lib/conversation-transcript";

const streamAgent =
  vi.fn<
    (
      payload: unknown,
      onEvent: (event: AgentEvent) => void,
      signal?: AbortSignal,
    ) => Promise<void>
  >();

vi.mock("@/lib/agent-stream", () => ({
  streamAgent: (payload: unknown, onEvent: (event: AgentEvent) => void, signal?: AbortSignal) =>
    streamAgent(payload, onEvent, signal),
}));

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, api: { ...actual.api, mediaBlob: vi.fn() } };
});

vi.mock("@/hooks/use-catia-status", () => ({
  useCatiaStatus: () => ({
    state: "offline" as const,
    status: null,
    detail: "No workstation has been paired with this account yet.",
    events: [],
    lastEvent: null,
    refresh: () => {},
  }),
}));

const { ChatView } = await import("./chat-view");

const user = { fullName: "Aziz Bahloul", email: "aziz@example.com" };

describe("ChatView", () => {
  it("greets by first name and offers the three engineering openers", () => {
    render(<ChatView {...user} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/, Aziz$/);
    expect(screen.getByText("What are we building?")).toBeInTheDocument();
    expect(
      screen.getByText("Model a mounting bracket, 120 × 80 × 10 mm, with four M6 holes"),
    ).toBeInTheDocument();
    expect(screen.getByText("Clamp the base, hang 40 kg off the top face, and run it")).toBeInTheDocument();
    expect(
      screen.getByText("Where is this part going to fail, and what should I thicken?"),
    ).toBeInTheDocument();
  });

  it("falls back to the email handle when there is no name on the account", () => {
    render(<ChatView fullName={null} email="aziz@example.com" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/, aziz$/);
  });

  it("loads a suggestion into the composer instead of sending it blind", async () => {
    render(<ChatView {...user} />);

    await userEvent.click(
      screen.getByText("Clamp the base, hang 40 kg off the top face, and run it"),
    );

    expect(screen.getByRole("textbox", { name: /message the kryova agent/i })).toHaveValue(
      "Clamp the base, hang 40 kg off the top face, and run it",
    );
  });

  it("rehydrates a stored transcript, so a refresh does not lose the conversation", () => {
    const turns: Turn[] = [
      { id: "m-1", role: "user", content: "Model a bracket 120 x 80 x 10" },
      {
        id: "m-2",
        role: "assistant",
        content: "Done — **Pad.1** created.",
        steps: [
          {
            id: "call_1",
            tool: "catia_pad",
            label: "Pad",
            arguments: { length_mm: 10 },
            status: "ok",
            summary: "Pad.1",
          },
        ],
      },
    ];

    render(
      <ChatView
        {...user}
        conversationId="conv-1"
        title="Bracket assembly"
        initialTurns={turns}
        boundDocument="Bracket.CATPart"
      />,
    );

    expect(screen.getByText("Model a bracket 120 x 80 x 10")).toBeInTheDocument();
    // The answer is rendered as markdown, so the bold survives as emphasis.
    expect(screen.getByText("Pad.1", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("Pad")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bracket assembly" })).toBeInTheDocument();
    // The greeting belongs to the empty state only.
    expect(screen.queryByText("What are we building?")).not.toBeInTheDocument();
  });

  it("shows CATIA state next to the composer, with the reason attached", () => {
    render(<ChatView {...user} />);

    const chip = screen.getByRole("link", { name: /CATIA/ });
    expect(chip).toHaveAttribute("href", "/dashboard/settings#catia");
    expect(chip).toHaveAttribute(
      "title",
      "No workstation has been paired with this account yet.",
    );
  });
});


/**
 * The step counter, driven through the real stream handler.
 *
 * These go through the hook rather than rendering `AgentStepList` directly,
 * because every defect here was in the *wiring*: which event cleared what. A
 * component test cannot see that `tool_start` used to blank the readout.
 */
describe("ChatView — the step counter", () => {
  let emit: (event: AgentEvent) => void;
  let settle: () => void;

  beforeEach(() => {
    streamAgent.mockReset();
    streamAgent.mockImplementation((_payload, onEvent, signal) => {
      emit = onEvent;
      return new Promise<void>((resolve, reject) => {
        settle = resolve;
        signal?.addEventListener("abort", () => {
          const aborted = new Error("The user stopped the run.");
          aborted.name = "AbortError";
          reject(aborted);
        });
      });
    });
  });

  const thinking = (round: number, max = 20): AgentEvent => ({
    type: "thinking",
    step: round,
    max_steps: max,
  });
  const toolStart = (id: string, label: string): AgentEvent => ({
    type: "tool_start",
    id,
    tool: "catia_pad",
    label,
    arguments: { length_mm: 10 },
  });
  const toolEnd = (id: string): AgentEvent => ({
    type: "tool_end",
    id,
    tool: "catia_pad",
    ok: true,
    result: { name: "Pad.1" },
    summary: "Pad.1",
    duration_ms: 12,
  });

  function send(...events: AgentEvent[]) {
    act(() => {
      for (const event of events) emit(event);
    });
  }

  /** The step panel. Scoped, because the announcement says similar things. */
  function panel(): HTMLElement {
    return screen.getByText("What the assistant is doing").closest("div.rounded-lg")!;
  }

  /** The first `aria-live` region: what a screen reader is hearing right now. */
  function announced(): string {
    return document.querySelectorAll('p[aria-live="polite"]')[0]?.textContent?.trim() ?? "";
  }

  async function startTurn() {
    render(<ChatView {...user} conversationId="conv-1" title="Bracket" />);
    await userEvent.type(
      screen.getByRole("textbox", { name: /message the kryova agent/i }),
      "Model a bracket",
    );
    await userEvent.click(screen.getByRole("button", { name: /send message/i }));
    await waitFor(() => expect(streamAgent).toHaveBeenCalled());
  }

  it("does not blink out for the duration of every tool call", async () => {
    await startTurn();

    send(thinking(1));
    expect(within(panel()).getByText("Thinking")).toBeInTheDocument();

    // `tool_start` used to clear the loop state outright, so the readout
    // disappeared here — for the whole of the call, which is the only part of
    // a turn that takes real time.
    send(toolStart("c1", "Pad"));
    expect(within(panel()).getByText("step 1")).toBeInTheDocument();
    expect(within(panel()).queryByText("Thinking")).not.toBeInTheDocument();

    send(toolEnd("c1"));
    expect(within(panel()).getByText("1 step")).toBeInTheDocument();

    send(thinking(2));
    expect(within(panel()).getByText("1 step")).toBeInTheDocument();
    expect(within(panel()).getByText("Thinking")).toBeInTheDocument();

    send(toolStart("c2", "Fillet"));
    expect(within(panel()).getByText("step 2")).toBeInTheDocument();
  });

  it("is not moved by the agent correcting itself", async () => {
    await startTurn();

    // Three rounds, no tools: `agent.py` `continue`s when the model writes a
    // tool call as prose or answers with nothing. Real budget spent, no work
    // done, and nothing for the user to see yet.
    send(thinking(1), thinking(2), thinking(3));
    expect(within(panel()).queryByText(/step \d/)).not.toBeInTheDocument();

    send(toolStart("c1", "Pad"));
    expect(within(panel()).getByText("step 1")).toBeInTheDocument();
    expect(within(panel()).queryByText("step 3")).not.toBeInTheDocument();
    expect(within(panel()).queryByText(/\/20/)).not.toBeInTheDocument();
  });

  it("counts one round that ran three tools as three steps", async () => {
    await startTurn();

    // The other direction: one loop round can run several tools, so the round
    // number understates the list as easily as a correction overstates it.
    send(thinking(1), toolStart("c1", "Pad"), toolEnd("c1"));
    send(toolStart("c2", "Pocket"), toolEnd("c2"));
    send(toolStart("c3", "Fillet"), toolEnd("c3"));

    expect(within(panel()).getByText("3 steps")).toBeInTheDocument();
  });

  it("announces exactly what the list shows", async () => {
    await startTurn();

    send(thinking(1), toolStart("c1", "Pad"));
    expect(announced()).toBe("Running step 1, Pad");

    send(toolEnd("c1"), thinking(2));
    expect(announced()).toBe("Thinking, 1 step done");
  });

  it("says nothing about the budget until the turn is about to hit it", async () => {
    await startTurn();

    send(thinking(1), toolStart("c1", "Pad"), toolEnd("c1"));
    expect(within(panel()).queryByText(/tool rounds? left/)).not.toBeInTheDocument();
    // The tool has returned and the next round has not begun: one step done,
    // and nothing claiming the model is composing while it is not.
    expect(announced()).toBe("1 step done");

    send(thinking(18));
    expect(within(panel()).getByText("2 tool rounds left")).toBeInTheDocument();
    expect(announced()).toBe("Thinking, 1 step done, 2 tool rounds left");

    // And it survives the tool call. `tool_start` used to clear the loop state
    // outright, which took the ceiling with it — so the one warning that says
    // the turn is about to be cut off vanished for the whole of every call.
    send(toolStart("c2", "Fillet"));
    expect(within(panel()).getByText("2 tool rounds left")).toBeInTheDocument();
    expect(announced()).toBe("Running step 2, Fillet, 2 tool rounds left");
  });

  it("clears when the turn finishes", async () => {
    await startTurn();

    send(thinking(1), toolStart("c1", "Pad"), toolEnd("c1"), thinking(2));
    send(
      { type: "message", content: "Done — Pad.1 created." },
      { type: "done", conversation_id: "conv-1", project_id: null, truncated: false, steps: 1 },
    );
    await act(async () => {
      settle();
    });

    expect(within(panel()).queryByText("Thinking")).not.toBeInTheDocument();
    expect(announced()).toBe("");
    // The settled turn keeps its count: the number came from the steps, and
    // the steps are still there.
    expect(within(panel()).getByText("1 step")).toBeInTheDocument();
  });

  it("clears when the turn errors, and does not leave a step running", async () => {
    await startTurn();

    send(thinking(1), toolStart("c1", "Pad"));
    send({ type: "error", message: "The workstation went offline." });
    await act(async () => {
      settle();
    });

    expect(within(panel()).queryByText("Thinking")).not.toBeInTheDocument();
    expect(within(panel()).queryByText("running…")).not.toBeInTheDocument();
    expect(within(panel()).getByText(/Interrupted/)).toBeInTheDocument();
    expect(within(panel()).getByText("1 step")).toBeInTheDocument();
  });

  it("clears when the user stops the run, and stops calling the step live", async () => {
    await startTurn();

    send(thinking(1), toolStart("c1", "Pad"));
    await userEvent.click(screen.getByRole("button", { name: /stop the current run/i }));

    await waitFor(() => expect(screen.getByText(/You stopped this run\./)).toBeInTheDocument());
    expect(within(panel()).queryByText("Thinking")).not.toBeInTheDocument();
    expect(within(panel()).queryByText("running…")).not.toBeInTheDocument();
    // Stopping the stream does not stop the seat, so the step says it was
    // stopped rather than that it failed.
    expect(within(panel()).getByText(/Stopped/)).toBeInTheDocument();
    expect(within(panel()).getByText("1 step")).toBeInTheDocument();
  });
});
