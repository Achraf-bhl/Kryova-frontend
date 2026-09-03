import { describe, expect, it } from "vitest";

import {
  SELECTORS_FOR_LOAD,
  changeLoadType,
  defaultSelector,
  impliedDofs,
  isBodyLoad,
  newFixture,
  newLoad,
  toPayload,
  validateLoadCase,
  type FixtureRow,
  type LoadRow,
} from "@/lib/load-case";
import type { Material } from "@/types/api";

const STEEL: Material = {
  name: "steel-1018",
  youngs_modulus_mpa: 205000,
  poissons_ratio: 0.29,
  yield_strength_mpa: 370,
  density_kg_m3: 7870,
};

describe("row identity", () => {
  it("gives every row a distinct id", () => {
    // Rows are deleted from the middle. With an index key React reuses the
    // removed row's DOM node for its successor and focus jumps mid-edit.
    const ids = [newFixture(), newFixture(), newLoad(), newLoad()].map((row) => row.id);
    expect(new Set(ids).size).toBe(4);
  });
});

describe("impliedDofs", () => {
  it("derives a clamp without needing a normal", () => {
    expect(impliedDofs("clamp", undefined)).toEqual(["x", "y", "z"]);
  });

  it("holds only the normal for a roller", () => {
    expect(impliedDofs("roller", "z")).toEqual(["z"]);
  });

  it("holds everything but the normal for a slider", () => {
    expect(impliedDofs("slider", "z")).toEqual(["x", "y"]);
  });

  it("treats symmetry as a roller", () => {
    expect(impliedDofs("symmetry", "x")).toEqual(impliedDofs("roller", "x"));
  });

  it("derives nothing for a custom fixture", () => {
    expect(impliedDofs("custom", "z")).toBeNull();
  });
});

describe("changeLoadType", () => {
  it("keeps the region when the new type can use it", () => {
    const load = newLoad("force");
    const box = defaultSelector("box");
    const withBox = { ...load, where: box } as LoadRow;

    const moment = changeLoadType(withBox, "moment");
    expect(moment.type).toBe("moment");
    expect("where" in moment && moment.where).toEqual(box);
  });

  it("replaces a region the new type cannot use", () => {
    // A bearing load needs a cylinder: it is the bore's axis that decides which
    // half carries the load, so carrying a face across would be nonsense.
    const load = { ...newLoad("force"), where: defaultSelector("face") } as LoadRow;
    const bearing = changeLoadType(load, "bearing");
    expect("where" in bearing && bearing.where.type).toBe("cylinder");
  });

  it("drops the region entirely for a body load", () => {
    const bearing = changeLoadType(newLoad("force"), "gravity");
    expect("where" in bearing).toBe(false);
    expect(isBodyLoad(bearing)).toBe(true);
  });

  it("keeps the row id and name across the change", () => {
    const load = { ...newLoad("force"), name: "tip load" };
    const changed = changeLoadType(load, "pressure");
    expect(changed.id).toBe(load.id);
    expect(changed.name).toBe("tip load");
  });

  it("only ever offers a cylinder to a bearing load", () => {
    expect(SELECTORS_FOR_LOAD.bearing).toEqual(["cylinder"]);
  });
});

describe("validateLoadCase", () => {
  const clamp = (): FixtureRow => newFixture();

  it("accepts a plain force on a clamped part", () => {
    expect(validateLoadCase([clamp()], [newLoad("force")], STEEL)).toEqual([]);
  });

  it("insists on a material", () => {
    expect(validateLoadCase([clamp()], [newLoad()], undefined)).toContain(
      "Choose a material.",
    );
  });

  it("insists on at least one fixture", () => {
    const problems = validateLoadCase([], [newLoad()], STEEL);
    expect(problems.some((problem) => problem.includes("at least one fixture"))).toBe(true);
  });

  it("rejects a force of zero, which applies nothing", () => {
    const load = { ...newLoad("force"), force_n: [0, 0, 0] } as LoadRow;
    const problems = validateLoadCase([clamp()], [load], STEEL);
    expect(problems.some((problem) => problem.includes("applies nothing"))).toBe(true);
  });

  it("rejects a bearing load that is not on a cylinder", () => {
    const load = {
      ...newLoad("bearing"),
      where: defaultSelector("face"),
    } as LoadRow;
    const problems = validateLoadCase([clamp()], [load], STEEL);
    expect(problems.some((problem) => problem.includes("cylinder region"))).toBe(true);
  });

  it("rejects an inverted box", () => {
    const fixture = {
      ...clamp(),
      where: { type: "box" as const, min: [10, 0, 0] as [number, number, number], max: [0, 0, 0] as [number, number, number] },
    };
    const problems = validateLoadCase([fixture], [newLoad()], STEEL);
    expect(problems.some((problem) => problem.includes("minimum corner is above"))).toBe(true);
  });

  it("rejects a roller with no axis to hold", () => {
    const fixture = { ...clamp(), kind: "roller" as const, normal: undefined };
    const problems = validateLoadCase([fixture], [newLoad()], STEEL);
    expect(problems.some((problem) => problem.includes("needs the axis it holds"))).toBe(true);
  });

  it("rejects a custom fixture that holds nothing", () => {
    const fixture = { ...clamp(), kind: "custom" as const, dofs: [] };
    const problems = validateLoadCase([fixture], [newLoad()], STEEL);
    expect(problems.some((problem) => problem.includes("at least one axis"))).toBe(true);
  });

  it("reports every problem at once, not just the first", () => {
    // The server answers with the first failure after a round trip; the point
    // of validating here is that one correction pass fixes everything.
    const bad = { ...newLoad("force"), force_n: [0, 0, 0] } as LoadRow;
    const problems = validateLoadCase([], [bad], undefined);
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects a centrifugal load with no speed", () => {
    const load = { ...newLoad("centrifugal"), rpm: 0 } as LoadRow;
    const problems = validateLoadCase([clamp()], [load], STEEL);
    expect(problems.some((problem) => problem.includes("above zero"))).toBe(true);
  });
});

describe("toPayload", () => {
  it("strips the editor's local ids", () => {
    const payload = toPayload("Case", STEEL, [newFixture()], [newLoad()]);
    expect(payload.fixtures[0]).not.toHaveProperty("id");
    expect(payload.loads[0]).not.toHaveProperty("id");
  });

  it("drops a blank name rather than sending an empty string", () => {
    const payload = toPayload("Case", STEEL, [newFixture()], [newLoad()]);
    expect(payload.fixtures[0]).not.toHaveProperty("name");
  });

  it("keeps a name the user actually typed", () => {
    const fixture = { ...newFixture(), name: "bolted base" };
    const payload = toPayload("Case", STEEL, [fixture], [newLoad()]);
    expect(payload.fixtures[0].name).toBe("bolted base");
  });

  it("falls back to a default case name", () => {
    expect(toPayload("   ", STEEL, [newFixture()], [newLoad()]).name).toBe("Load case");
  });

  it("carries every fixture and load through", () => {
    const payload = toPayload(
      "Case",
      STEEL,
      [newFixture(), newFixture(), newFixture()],
      [newLoad("force"), newLoad("gravity")],
    );
    expect(payload.fixtures).toHaveLength(3);
    expect(payload.loads).toHaveLength(2);
    expect(payload.loads[1].type).toBe("gravity");
  });

  it("keeps the discriminator the server reads", () => {
    const payload = toPayload("Case", STEEL, [newFixture()], [newLoad("pressure")]);
    expect(payload.loads[0]).toMatchObject({ type: "pressure" });
  });
});
