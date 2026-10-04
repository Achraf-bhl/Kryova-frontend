import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ContinuePrompt } from "./continue-prompt";
import type { NextAction } from "@/lib/agent-stream";

/**
 * What this guards is a button that sends the wrong thing or sends it twice.
 * Continue exists so that nobody types "go on" and the model starts the design
 * again, so the contract is: pressing it calls back once, with nothing the
 * user typed, and the consequence is printed where it can be read first.
 */

const ACTION: NextAction = {
  kind: "continue",
  reason: "step_budget",
  label: "Continue",
  detail: "Carries on from the first open task, using what is already built.",
  open_tasks: [
    { id: "t2", title: "Cut the mounting holes", state: "pending" },
    { id: "t3", title: "Add the fillets", state: "pending" },
  ],
};

describe("Continue is one press that carries the server's own instruction", () => {
  it("prints what pressing it will do", () => {
    render(<ContinuePrompt action={ACTION} onContinue={vi.fn()} />);
    expect(screen.getByText(ACTION.detail)).toBeTruthy();
  });

  it("names the open work it will resume", () => {
    render(<ContinuePrompt action={ACTION} onContinue={vi.fn()} />);
    expect(screen.getByText("Cut the mounting holes")).toBeTruthy();
    expect(screen.getByText("Add the fillets")).toBeTruthy();
  });

  it("calls back with no text at all", () => {
    const onContinue = vi.fn();
    render(<ContinuePrompt action={ACTION} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledWith();
  });

  it("cannot be pressed twice in the gap before the stream starts", () => {
    // Between the press and the first event `busy` is still false, so the
    // parent's own guard does not hold; the latch is the only thing that does.
    const onContinue = vi.fn();
    render(<ContinuePrompt action={ACTION} onContinue={onContinue} />);
    const button = screen.getByRole("button", { name: "Continue" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("is inert while the conversation is busy", () => {
    const onContinue = vi.fn();
    render(<ContinuePrompt action={ACTION} onContinue={onContinue} disabled />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("counts the tasks it does not list instead of dropping them", () => {
    const many: NextAction = {
      ...ACTION,
      open_tasks: Array.from({ length: 7 }, (_, i) => ({
        id: `t${i}`,
        title: `Task ${i}`,
        state: "pending",
      })),
    };
    render(<ContinuePrompt action={many} onContinue={vi.fn()} />);
    expect(screen.getByText("and 3 more")).toBeTruthy();
  });

  it("works with no plan declared", () => {
    render(
      <ContinuePrompt action={{ ...ACTION, open_tasks: [] }} onContinue={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });
});
