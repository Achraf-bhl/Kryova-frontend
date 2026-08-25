import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AgentStepList, type StepView } from "./agent-step-list";

function step(overrides: Partial<StepView> = {}): StepView {
  return {
    id: "c1",
    tool: "list_projects",
    label: "Looking up your projects",
    arguments: {},
    status: "ok",
    summary: "Found 2 project(s)",
    durationMs: 12,
    ...overrides,
  };
}

describe("AgentStepList", () => {
  it("renders nothing when there is no activity", () => {
    const { container } = render(<AgentStepList steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the human label and summary, not the raw tool name", () => {
    render(<AgentStepList steps={[step()]} />);
    expect(screen.getByText("Looking up your projects")).toBeInTheDocument();
    expect(screen.getByText(/Found 2 project\(s\)/)).toBeInTheDocument();
  });

  it("shows elapsed time once a step finishes", () => {
    render(<AgentStepList steps={[step({ durationMs: 143 })]} />);
    expect(screen.getByText("143 ms")).toBeInTheDocument();
  });

  it("shows a running indicator instead of a duration while in flight", () => {
    render(<AgentStepList steps={[step({ status: "running", durationMs: undefined })]} />);
    expect(screen.getByText("running…")).toBeInTheDocument();
  });

  it("keeps the payload collapsed until the user asks for it", async () => {
    const user = userEvent.setup();
    render(
      <AgentStepList
        steps={[step({ arguments: { project_id: "p1" }, result: { projects: [] } })]}
      />,
    );

    // Collapsed: the summary is what matters, the JSON is opt-in.
    expect(screen.queryByText(/project_id/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Looking up your projects/ }));
    expect(screen.getByText(/project_id/)).toBeInTheDocument();
    expect(screen.getByText("list_projects")).toBeInTheDocument();
  });

  it("surfaces a failed step as an error, not a success", () => {
    render(
      <AgentStepList
        steps={[step({ status: "error", summary: "No project with id 'x' belongs to you." })]}
      />,
    );
    expect(screen.getByText(/belongs to you/)).toBeInTheDocument();
  });

  it("reports which step of the budget the agent is on", () => {
    render(<AgentStepList steps={[]} thinking={{ step: 3, maxSteps: 8 }} />);
    expect(screen.getByText("step 3/8")).toBeInTheDocument();
    expect(screen.getByText("Thinking")).toBeInTheDocument();
  });
});
