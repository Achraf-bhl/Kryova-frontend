import { describe, expect, it } from "vitest";

import type { StepView } from "@/components/agent-step-list";

import { MIN_FOLDED_READS, groupSteps, hasPlan, isReadTool } from "./step-groups";

let n = 0;
function step(tool: string, over: Partial<StepView> = {}): StepView {
  n += 1;
  return { id: `s${n}`, tool, label: tool, arguments: {}, status: "ok", ...over };
}
const plan = () =>
  step("plan_work", {
    arguments: {
      tasks: [
        { id: "frame", title: "Build the frame" },
        { id: "ram", title: "Size the ram" },
      ],
    },
  });
const update = (id: string, state: string, over: Partial<StepView> = {}) =>
  step("update_task", { arguments: { id, state }, ...over });

describe("isReadTool", () => {
  it("recognises looking and not doing", () => {
    expect(isReadTool("catia_list_features")).toBe(true);
    expect(isReadTool("get_design")).toBe(true);
    expect(isReadTool("catia_pad")).toBe(false);
    expect(isReadTool("run_simulation")).toBe(false);
  });
});

describe("groupSteps with no plan", () => {
  it("is one ungrouped run, in order", () => {
    const steps = [step("catia_pad"), step("catia_pocket")];
    const groups = groupSteps(steps);
    expect(hasPlan(groups)).toBe(false);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => (i.kind === "step" ? i.step.tool : "reads"))).toEqual([
      "catia_pad",
      "catia_pocket",
    ]);
  });
});

describe("groupSteps with a plan", () => {
  it("puts the steps between an active mark and its done under that task", () => {
    const groups = groupSteps([
      plan(),
      update("frame", "active"),
      step("catia_pad"),
      step("catia_pocket"),
      update("frame", "done"),
      update("ram", "active"),
      step("run_simulation"),
    ]);
    expect(hasPlan(groups)).toBe(true);
    const frame = groups.find((g) => g.taskId === "frame")!;
    expect(frame.title).toBe("Build the frame");
    expect(frame.state).toBe("done");
    expect(frame.items).toHaveLength(2);
    const ram = groups.find((g) => g.taskId === "ram")!;
    expect(ram.state).toBe("active");
    expect(ram.items).toHaveLength(1);
  });

  it("keeps the plan call itself outside any task", () => {
    const groups = groupSteps([plan(), update("frame", "active"), step("catia_pad")]);
    expect(groups[0].taskId).toBeNull();
    expect(groups[0].items).toHaveLength(1);
  });

  it("never consumes a refused update — it stays a visible row in its group", () => {
    const refused = update("ram", "done", { status: "error", summary: "cannot be marked done while frame is open" });
    const groups = groupSteps([plan(), update("frame", "active"), refused]);
    const frame = groups.find((g) => g.taskId === "frame")!;
    expect(frame.items).toEqual([{ kind: "step", step: refused }]);
  });

  it("names a task by its id when the plan gave no title", () => {
    const groups = groupSteps([update("mystery", "active"), step("catia_pad")]);
    expect(groups.find((g) => g.taskId === "mystery")?.title).toBe("mystery");
  });
});

describe("folding reads", () => {
  const reads = (count: number) => Array.from({ length: count }, () => step("catia_list_features"));

  it("folds a run of successful reads that reaches the threshold", () => {
    const [group] = groupSteps([...reads(MIN_FOLDED_READS), step("catia_pad")]);
    expect(group.items[0]).toMatchObject({ kind: "reads" });
    expect(group.items).toHaveLength(2);
  });

  it("leaves a short run alone", () => {
    const [group] = groupSteps(reads(MIN_FOLDED_READS - 1));
    expect(group.items.every((i) => i.kind === "step")).toBe(true);
  });

  it("does not fold a failed read, and the failure splits the run", () => {
    const failed = step("catia_list_features", { status: "error", summary: "no document" });
    const [group] = groupSteps([...reads(MIN_FOLDED_READS), failed, ...reads(MIN_FOLDED_READS)]);
    expect(group.items.map((i) => i.kind)).toEqual(["reads", "step", "reads"]);
  });

  it("does not fold a read that drew a picture", () => {
    const withImage = step("catia_get_view", { result: { media_id: "m1", content_type: "image/png", view: "iso" } });
    const [group] = groupSteps([...reads(2), withImage]);
    expect(group.items.every((i) => i.kind === "step")).toBe(true);
  });
});
