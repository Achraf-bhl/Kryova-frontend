import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InterventionPrompt } from "./intervention-prompt";
import type { Intervention } from "@/lib/agent-stream";

/**
 * The failure this component guards is not "no prompt appears". It is a prompt
 * that appears and quietly answers itself — a preselected option, a highlighted
 * recommendation, or a list with no way out. All three render as a decision and
 * all three take it away from the user, and none of them looks wrong on screen,
 * which is why they are asserted rather than reviewed.
 */

const DECISION: Intervention = {
  kind: "repeated-failure",
  question: "Should I work from what does exist, or has something been renamed?",
  cause: "`catia_pad` on plate.body failed 3 times and each time it names something that is not there.",
  subject: "plate.body",
  tool: "catia_pad",
  quote: "No feature named 'plate.body' exists in this document.",
  gate_id: null,
  answer_in_words: true,
  choices: [
    {
      id: "work-from-what-exists",
      label: "Work from what is there",
      detail: "Carry on using what the document actually contains now.",
      needs_reason: false,
    },
    {
      id: "it-moved",
      label: "Something was renamed or deleted",
      detail: "Tell me what it is now and I will use that instead.",
      needs_reason: true,
    },
    {
      id: "stop",
      label: "Stop here",
      detail: "Keep everything that is built and end the turn.",
      needs_reason: false,
    },
  ],
};

describe("the decision is put to the user, not taken for them", () => {
  it("offers every choice as a real control", () => {
    render(<InterventionPrompt intervention={DECISION} onAnswer={vi.fn()} />);

    for (const choice of DECISION.choices) {
      expect(screen.getByRole("button", { name: new RegExp(choice.label) })).toBeTruthy();
    }
  });

  it("styles no choice differently from the others", () => {
    // The rule with no other enforcement: the backend can refuse a `recommended`
    // field, and it cannot stop a `primary` class being the recommendation.
    render(<InterventionPrompt intervention={DECISION} onAnswer={vi.fn()} />);

    const classes = DECISION.choices.map(
      (choice) =>
        screen.getByRole("button", { name: new RegExp(choice.label) }).className,
    );

    expect(new Set(classes).size).toBe(1);
  });

  it("preselects nothing", () => {
    render(<InterventionPrompt intervention={DECISION} onAnswer={vi.fn()} />);

    for (const button of screen.getAllByRole("button")) {
      expect(button.getAttribute("aria-pressed")).toBeNull();
      expect(button.getAttribute("data-selected")).toBeNull();
      expect(button.hasAttribute("autofocus")).toBe(false);
    }
  });

  it("prints what each option will do, not only its name", () => {
    render(<InterventionPrompt intervention={DECISION} onAnswer={vi.fn()} />);

    for (const choice of DECISION.choices) {
      expect(screen.getByText(choice.detail)).toBeTruthy();
    }
  });

  it("says the options are not the only answers", () => {
    render(<InterventionPrompt intervention={DECISION} onAnswer={vi.fn()} />);

    expect(screen.getByText(/not the only ones/i)).toBeTruthy();
  });
});

describe("what it shows about the failure", () => {
  it("quotes the machine verbatim", () => {
    render(<InterventionPrompt intervention={DECISION} onAnswer={vi.fn()} />);

    expect(screen.getByText(DECISION.quote)).toBeTruthy();
  });

  it("states the question and the cause", () => {
    render(<InterventionPrompt intervention={DECISION} onAnswer={vi.fn()} />);

    expect(screen.getByText(DECISION.question)).toBeTruthy();
    expect(screen.getByText(DECISION.cause)).toBeTruthy();
  });

  it("renders without a quote when there is none", () => {
    render(
      <InterventionPrompt
        intervention={{ ...DECISION, quote: "" }}
        onAnswer={vi.fn()}
      />,
    );

    expect(screen.getByText(DECISION.question)).toBeTruthy();
  });

  it("names an approval as a sign-off rather than as a failure", () => {
    render(
      <InterventionPrompt
        intervention={{ ...DECISION, kind: "approval", gate_id: "g1" }}
        onAnswer={vi.fn()}
      />,
    );

    expect(screen.getByText(/waiting for your sign-off/i)).toBeTruthy();
  });
});

describe("answering", () => {
  it("sends the choice in words a person can read in the transcript", () => {
    const onAnswer = vi.fn();
    render(<InterventionPrompt intervention={DECISION} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByRole("button", { name: /Work from what is there/ }));

    expect(onAnswer).toHaveBeenCalledWith("Work from what is there");
  });

  it("asks for a reason before sending a choice that needs one", () => {
    const onAnswer = vi.fn();
    render(<InterventionPrompt intervention={DECISION} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByRole("button", { name: /Something was renamed/ }));

    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("will not send an empty reason", () => {
    // A rejection with no reason tells the agent nothing about what to do next,
    // which is the backend's rule for a gate and is just as true here.
    render(<InterventionPrompt intervention={DECISION} onAnswer={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Something was renamed/ }));

    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;

    expect(send.disabled).toBe(true);
  });

  it("sends the choice and the reason together", () => {
    const onAnswer = vi.fn();
    render(<InterventionPrompt intervention={DECISION} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: /Something was renamed/ }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "it is called base_plate now" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onAnswer).toHaveBeenCalledWith(
      "Something was renamed or deleted — it is called base_plate now",
    );
  });

  it("lets the user back out of the reason box without answering", () => {
    const onAnswer = vi.fn();
    render(<InterventionPrompt intervention={DECISION} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: /Something was renamed/ }));

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Work from what is there/ })).toBeTruthy();
  });

  it("cannot be answered twice", () => {
    // The turn has already moved on; a second press would send a contradictory
    // instruction into a conversation that is acting on the first.
    const onAnswer = vi.fn();
    render(<InterventionPrompt intervention={DECISION} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByRole("button", { name: /Stop here/ }));

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Stop here/ })).toBeNull();
    expect(screen.getByText(/Sent\./)).toBeTruthy();
  });

  it("answers nothing while the agent is busy", () => {
    const onAnswer = vi.fn();
    render(
      <InterventionPrompt intervention={DECISION} onAnswer={onAnswer} disabled />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Stop here/ }));

    expect(onAnswer).not.toHaveBeenCalled();
  });
});
