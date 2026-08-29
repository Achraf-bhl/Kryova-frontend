import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Composer } from "./composer";

/** The composer is controlled; this supplies the state a page would own. */
function Harness({
  onSubmit,
  busy = false,
  onStop,
}: {
  onSubmit?: (value: string) => void;
  busy?: boolean;
  onStop?: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSubmit={() => onSubmit?.(value)}
      busy={busy}
      onStop={onStop}
      deepAnalysis={false}
      onDeepAnalysisChange={() => {}}
    />
  );
}

const field = () => screen.getByRole("textbox", { name: /message the kryova agent/i });

describe("Composer", () => {
  it("sends on Enter", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await userEvent.type(field(), "make me a bracket{Enter}");

    expect(onSubmit).toHaveBeenCalledWith("make me a bracket");
  });

  it("inserts a newline on Shift+Enter instead of sending", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    // The old single-line `<input>` checked `shiftKey` on Enter to do this and
    // structurally could not hold the newline it promised.
    await userEvent.type(field(), "first{Shift>}{Enter}{/Shift}second");

    expect(onSubmit).not.toHaveBeenCalled();
    expect(field()).toHaveValue("first\nsecond");
  });

  it("does not send an empty or whitespace-only message", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await userEvent.type(field(), "{Enter}");
    await userEvent.type(field(), "   {Enter}");

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("ignores Enter while an IME candidate is being composed", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    fireEvent.change(field(), { target: { value: "ブラケット" } });
    fireEvent.keyDown(field(), { key: "Enter", isComposing: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the field usable while the agent is working", async () => {
    render(<Harness busy onStop={() => {}} />);

    // The point of the whole exercise: a CATIA build takes a minute and the
    // next instruction is already in the user's head.
    expect(field()).not.toBeDisabled();
    await userEvent.type(field(), "and then chamfer it");
    expect(field()).toHaveValue("and then chamfer it");
  });

  it("holds sending until the run finishes, and offers Stop instead", async () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    render(<Harness busy onSubmit={onSubmit} onStop={onStop} />);

    await userEvent.type(field(), "queued thought{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /waiting for the current run/i })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: /stop the current run/i }));
    expect(onStop).toHaveBeenCalled();
  });

  it("disables the send button until there is something to send", async () => {
    render(<Harness />);
    const send = screen.getByRole("button", { name: /send message/i });

    expect(send).toBeDisabled();
    await userEvent.type(field(), "hi");
    expect(send).toBeEnabled();
  });

  it("grows with the message rather than scrolling a single line", async () => {
    render(<Harness />);
    const textarea = field() as HTMLTextAreaElement;

    await userEvent.type(textarea, "one{Shift>}{Enter}{/Shift}two{Shift>}{Enter}{/Shift}three");

    // jsdom reports no layout, so the assertion is that the auto-grow ran and
    // set an explicit height at all — not what that height is.
    expect(textarea.style.height).not.toBe("");
  });
});
