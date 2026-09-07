import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mediaBlob = vi.fn();

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, api: { mediaBlob } };
});

const { AgentStepList, activityLabel, ceilingLabel, roundsLeft, stepCountLabel } = await import(
  "./agent-step-list"
);
type StepView = import("./agent-step-list").StepView;
type AgentProgress = import("./agent-step-list").AgentProgress;

function progress(overrides: Partial<AgentProgress> = {}): AgentProgress {
  return { composing: true, round: 1, maxRounds: 20, ...overrides };
}

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

  it("counts the steps it is showing, not the loop rounds behind them", () => {
    // The loop is on round 7 (self-corrections and multi-tool rounds both make
    // that number run ahead); the list has two rows. The panel reports the
    // list, because that is what the user is looking at.
    render(
      <AgentStepList
        steps={[step({ id: "a" }), step({ id: "b" })]}
        thinking={progress({ round: 7 })}
      />,
    );

    expect(screen.getByText("2 steps")).toBeInTheDocument();
    expect(screen.queryByText(/7/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/20/)).not.toBeInTheDocument();
  });

  it("says which step is in flight while one is running", () => {
    render(
      <AgentStepList
        steps={[step({ id: "a" }), step({ id: "b", status: "running", durationMs: undefined })]}
        thinking={progress({ composing: false, round: 4 })}
      />,
    );
    expect(screen.getByText("step 2")).toBeInTheDocument();
  });

  it("counts a single step in the singular", () => {
    render(<AgentStepList steps={[step()]} />);
    expect(screen.getByText("1 step")).toBeInTheDocument();
  });

  it("still counts the steps of a settled turn, which has no loop state left", () => {
    render(<AgentStepList steps={[step({ id: "a" }), step({ id: "b" }), step({ id: "c" })]} />);
    expect(screen.getByText("3 steps")).toBeInTheDocument();
  });

  it("shows no counter before the first step, and does not invent a zero", () => {
    render(<AgentStepList steps={[]} thinking={progress()} />);
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.queryByText(/step/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^0/)).not.toBeInTheDocument();
  });

  it("keeps the counter up while a tool runs, and drops only the thinking dots", () => {
    // The regression this exists for: `tool_start` used to clear the loop
    // state, so the readout blinked out for the whole duration of every call.
    render(
      <AgentStepList
        steps={[step({ status: "running", durationMs: undefined })]}
        thinking={progress({ composing: false })}
      />,
    );
    expect(screen.getByText("step 1")).toBeInTheDocument();
    expect(screen.queryByText("Thinking")).not.toBeInTheDocument();
  });

  it("says nothing about the budget while the turn is nowhere near it", () => {
    render(<AgentStepList steps={[step()]} thinking={progress({ round: 5, maxRounds: 20 })} />);
    expect(screen.queryByText(/round/)).not.toBeInTheDocument();
  });

  it("names the ceiling once the turn is about to hit it", () => {
    render(<AgentStepList steps={[step()]} thinking={progress({ round: 18, maxRounds: 20 })} />);
    expect(screen.getByText("2 tool rounds left")).toBeInTheDocument();
    // Still not a fraction: the cap is a reason the turn will stop, not a
    // measure of how much of it is done.
    expect(screen.queryByText(/18\/20/)).not.toBeInTheDocument();
  });
});

describe("the counter's arithmetic", () => {
  it("derives the count from the rows, so it cannot contradict them", () => {
    expect(stepCountLabel([])).toBeNull();
    expect(stepCountLabel([step()])).toBe("1 step");
    expect(stepCountLabel([step({ id: "a" }), step({ id: "b" })])).toBe("2 steps");
    expect(stepCountLabel([step({ id: "a" }), step({ id: "b", status: "running" })])).toBe(
      "step 2",
    );
    // A failed step is still a step that happened.
    expect(stepCountLabel([step({ status: "error" })])).toBe("1 step");
  });

  it("reports rounds left only inside the notice window", () => {
    expect(roundsLeft(null)).toBeNull();
    expect(roundsLeft(progress({ round: 1, maxRounds: 20 }))).toBeNull();
    expect(roundsLeft(progress({ round: 16, maxRounds: 20 }))).toBeNull();
    expect(roundsLeft(progress({ round: 17, maxRounds: 20 }))).toBe(3);
    expect(roundsLeft(progress({ round: 20, maxRounds: 20 }))).toBe(0);
    // A budget nobody sent is not a budget of zero.
    expect(roundsLeft(progress({ round: 0, maxRounds: 0 }))).toBeNull();
    expect(ceilingLabel(progress({ round: 19, maxRounds: 20 }))).toBe("1 tool round left");
  });

  it("announces the same numbers the panel shows", () => {
    expect(activityLabel([], null)).toBe("Working");
    expect(activityLabel([], progress())).toBe("Thinking");
    expect(activityLabel([step()], progress({ round: 2 }))).toBe("Thinking, 1 step done");
    expect(
      activityLabel([step({ status: "running", label: "Pad" })], progress({ composing: false })),
    ).toBe("Running step 1, Pad");
    expect(activityLabel([step()], progress({ composing: false, round: 19, maxRounds: 20 }))).toBe(
      "1 step done, 1 tool round left",
    );
  });
});

describe("AgentStepList — captured views", () => {
  const originalCreate = (URL as unknown as { createObjectURL?: unknown }).createObjectURL;

  afterEach(() => {
    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = originalCreate;
    mediaBlob.mockReset();
  });

  function withObjectUrls() {
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () =>
      "blob:mock/view";
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
  }

  it("shows a CATIA capture as a picture without the user expanding anything", async () => {
    withObjectUrls();
    mediaBlob.mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }));

    render(
      <AgentStepList
        steps={[
          step({
            tool: "catia_capture_view",
            label: "Looking at the part",
            summary: "iso view captured",
            // Exactly what `_store_capture` returns from a real seat.
            result: {
              media_id: "med_7f3a",
              view: "iso",
              label: "",
              width_px: null,
              height_px: null,
              size_bytes: 148213,
            },
          }),
        ]}
      />,
    );

    // Collapsed — the JSON is still opt-in — but the picture is not.
    expect(screen.queryByText(/med_7f3a/)).not.toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "iso view" })).toBeInTheDocument();
  });

  it("leaves every other tool result exactly as it was: JSON, behind the expander", async () => {
    const user = userEvent.setup();
    render(
      <AgentStepList
        steps={[step({ tool: "measure_part", result: { mass_kg: 2.41, volume_mm3: 307000 } })]}
      />,
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(mediaBlob).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Looking up your projects/ }));
    expect(screen.getByText(/mass_kg/)).toBeInTheDocument();
  });

  it("does not try to draw a media object with nothing raster about it", () => {
    render(
      <AgentStepList
        steps={[
          step({
            tool: "catia_checkpoint",
            result: { media_id: "med_ck", checkpoint_id: "c1", size_bytes: 91000 },
          }),
        ]}
      />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(mediaBlob).not.toHaveBeenCalled();
  });
});
