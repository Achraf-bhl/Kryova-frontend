import { describe, expect, it } from "vitest";

import type { NextAction } from "@/lib/agent-stream";
import { conversationToTurns } from "@/lib/conversation-transcript";
import type { ConversationMessage } from "@/types/conversation";

function message(partial: Partial<ConversationMessage> & { sequence: number }): ConversationMessage {
  return {
    role: "assistant",
    content: null,
    tool_call_id: null,
    tool_name: null,
    label: null,
    arguments: null,
    result: null,
    summary: null,
    is_error: false,
    duration_ms: null,
    created_at: "2026-08-29T09:00:00Z",
    ...partial,
  };
}

describe("conversationToTurns", () => {
  it("rebuilds a plain question and answer", () => {
    const turns = conversationToTurns([
      message({ sequence: 1, role: "user", content: "What is the factor of safety?" }),
      message({ sequence: 2, role: "assistant", content: "1.8 on the last run." }),
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: "user", content: "What is the factor of safety?" });
    expect(turns[1]).toMatchObject({ role: "assistant", content: "1.8 on the last run." });
  });

  it("attaches tool steps to the answer that follows them", () => {
    const turns = conversationToTurns([
      message({ sequence: 1, role: "user", content: "Run it" }),
      // The assistant row that requested the tool carries no text of its own.
      message({ sequence: 2, role: "assistant", content: null }),
      message({
        sequence: 3,
        role: "tool",
        tool_call_id: "call_1",
        tool_name: "run_simulation",
        label: "Run simulation",
        arguments: { element_size_mm: 4 },
        result: { status: "succeeded" },
        summary: "Solved in 12 s",
        duration_ms: 12_000,
      }),
      message({ sequence: 4, role: "assistant", content: "Done — peak stress is 142 MPa." }),
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[1].content).toBe("Done — peak stress is 142 MPa.");
    expect(turns[1].steps).toHaveLength(1);
    expect(turns[1].steps?.[0]).toMatchObject({
      id: "call_1",
      tool: "run_simulation",
      label: "Run simulation",
      status: "ok",
      summary: "Solved in 12 s",
      durationMs: 12_000,
    });
  });

  it("does not attach a turn's steps to the previous answer", () => {
    const turns = conversationToTurns([
      message({ sequence: 1, role: "user", content: "first" }),
      message({ sequence: 2, role: "assistant", content: "first answer" }),
      message({ sequence: 3, role: "user", content: "second" }),
      message({
        sequence: 4,
        role: "tool",
        tool_call_id: "call_2",
        tool_name: "list_projects",
        label: "List projects",
      }),
      message({ sequence: 5, role: "assistant", content: "second answer" }),
    ]);

    expect(turns.find((turn) => turn.content === "first answer")?.steps).toBeUndefined();
    expect(turns.find((turn) => turn.content === "second answer")?.steps).toHaveLength(1);
  });

  it("marks a failed tool call as an error step", () => {
    const turns = conversationToTurns([
      message({ sequence: 1, role: "user", content: "pad it" }),
      message({
        sequence: 2,
        role: "tool",
        tool_call_id: "call_3",
        tool_name: "catia_pad",
        label: "Pad",
        is_error: true,
        summary: "No active document",
      }),
      message({ sequence: 3, role: "assistant", content: "CATIA has no document open." }),
    ]);

    expect(turns[1].steps?.[0].status).toBe("error");
  });

  it("keeps steps that never got an answer rather than dropping them", () => {
    const turns = conversationToTurns([
      message({ sequence: 1, role: "user", content: "build it" }),
      message({
        sequence: 2,
        role: "tool",
        tool_call_id: "call_4",
        tool_name: "catia_new_part",
        label: "New part",
      }),
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({ role: "assistant", content: "" });
    expect(turns[1].steps).toHaveLength(1);
  });

  it("orders by sequence even when the API returns rows out of order", () => {
    const turns = conversationToTurns([
      message({ sequence: 2, role: "assistant", content: "second" }),
      message({ sequence: 1, role: "user", content: "first" }),
    ]);

    expect(turns.map((turn) => turn.content)).toEqual(["first", "second"]);
  });

  it("gives every turn a distinct key", () => {
    const turns = conversationToTurns([
      message({ sequence: 1, role: "user", content: "a" }),
      message({ sequence: 2, role: "assistant", content: "b" }),
      message({ sequence: 3, role: "user", content: "c" }),
    ]);

    expect(new Set(turns.map((turn) => turn.id)).size).toBe(turns.length);
  });

  it("returns nothing for an empty transcript", () => {
    expect(conversationToTurns([])).toEqual([]);
  });
});

describe("a continuation is an act, not the user's words (2.2)", () => {
  const ACTION: NextAction = {
    kind: "continue",
    reason: "step_budget",
    label: "Continue",
    detail: "Carries on from the first open task.",
    open_tasks: [{ id: "t2", title: "Cut the holes", state: "pending" }],
  };

  it("draws the stored continuation as a marked divider and never as typed text", () => {
    const turns = conversationToTurns([
      message({ sequence: 1, role: "user", content: "Build the bracket" }),
      message({ sequence: 2, role: "assistant", content: "Ran out of rounds." }),
      message({
        sequence: 3,
        role: "user",
        content: "[kryova] Continue from t2: Cut the holes.",
        continuation: true,
      }),
      message({ sequence: 4, role: "assistant", content: "Holes cut." }),
    ]);

    expect(turns[2]).toMatchObject({ role: "user", continuation: true, content: "Continued" });
    // The server's instruction to the model never reaches the reader's thread.
    expect(turns.map((turn) => turn.content).join(" ")).not.toContain("[kryova]");
  });

  it("treats a row with no marker as the user's own words, as before", () => {
    const turns = conversationToTurns([
      message({ sequence: 1, role: "user", content: "continue please" }),
    ]);
    expect(turns[0]).toEqual({ id: "m-1", role: "user", content: "continue please" });
  });

  it("puts the stored next action on the newest assistant turn only", () => {
    const turns = conversationToTurns(
      [
        message({ sequence: 1, role: "user", content: "a" }),
        message({ sequence: 2, role: "assistant", content: "b" }),
        message({ sequence: 3, role: "user", content: "c" }),
        message({ sequence: 4, role: "assistant", content: "d" }),
      ],
      ACTION,
    );
    expect(turns[1]?.nextAction).toBeUndefined();
    expect(turns[3]?.nextAction).toEqual(ACTION);
  });

  it("draws no button when the thread ends on the user's turn", () => {
    // A stale payload after something was said is the server's mistake to
    // avoid, and the client does not compound it.
    const turns = conversationToTurns(
      [
        message({ sequence: 1, role: "user", content: "a" }),
        message({ sequence: 2, role: "assistant", content: "b" }),
        message({ sequence: 3, role: "user", content: "c" }),
      ],
      ACTION,
    );
    expect(turns.some((turn) => turn.nextAction)).toBe(false);
  });

  it("draws no button when the server sent none", () => {
    const turns = conversationToTurns(
      [
        message({ sequence: 1, role: "user", content: "a" }),
        message({ sequence: 2, role: "assistant", content: "b" }),
      ],
      null,
    );
    expect(turns.some((turn) => turn.nextAction)).toBe(false);
  });
});
