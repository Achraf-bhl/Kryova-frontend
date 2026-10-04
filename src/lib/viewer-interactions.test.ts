import { describe, expect, it } from "vitest";

import {
  bookmark,
  corners,
  describeView,
  emptyView,
  explodedOffset,
  isCutAway,
  isUnder,
  restore,
  visibleParts,
  type Box,
  type SectionPlane,
  type ViewerPart,
  type ViewState,
} from "./viewer-interactions";

/**
 * P6 task 4, tested as the four traps it is built around.
 *
 * This module and these tests were claimed by the master plan on 2026-09-16 and had never
 * been committed — one of ten such paths found by the audit of 2026-09-17. Every trap
 * below produces a *plausible wrong picture* rather than an error, which is why each test
 * names the picture rather than the branch.
 */

function box(min: [number, number, number], max: [number, number, number]): Box {
  return { min, max };
}

function part(path: string, min: [number, number, number], max: [number, number, number]): ViewerPart {
  return { path, box: box(min, max) };
}

/** A plane at x = 0 whose normal points at +x, so +x is the material removed. */
const CUT_POSITIVE_X: SectionPlane = { origin: [0, 0, 0], normal: [1, 0, 0] };

describe("trap 1: the normal points at the material removed", () => {
  it("removes the part on the normal's side, not the other one", () => {
    // `catia_split`'s convention. Two conventions for one question is how a part ends up
    // mirrored with every test green.
    expect(isCutAway(part("kept", [-20, -5, -5], [-10, 5, 5]), CUT_POSITIVE_X)).toBe(false);
    expect(isCutAway(part("gone", [10, -5, -5], [20, 5, 5]), CUT_POSITIVE_X)).toBe(true);
  });

  it("reverses when the normal reverses", () => {
    const flipped: SectionPlane = { origin: [0, 0, 0], normal: [-1, 0, 0] };

    expect(isCutAway(part("a", [10, -5, -5], [20, 5, 5]), flipped)).toBe(false);
    expect(isCutAway(part("a", [-20, -5, -5], [-10, 5, 5]), flipped)).toBe(true);
  });
});

describe("trap 2: sides are decided on the corners, not the centre", () => {
  it("keeps a long member that runs through the cut", () => {
    // Its centre is on the removed side, so a centre test would delete it — from the
    // section view it exists to appear in.
    const spanning = part("rail", [-100, -5, -5], [300, 5, 5]);

    expect(spanning.box.min[0] + spanning.box.max[0]).toBeGreaterThan(0); // centre is +x
    expect(isCutAway(spanning, CUT_POSITIVE_X)).toBe(false);
  });

  it("removes a part only when every corner is on the removed side", () => {
    expect(isCutAway(part("clear", [1, 1, 1], [2, 2, 2]), CUT_POSITIVE_X)).toBe(true);
    expect(isCutAway(part("touching", [0, 1, 1], [2, 2, 2]), CUT_POSITIVE_X)).toBe(false);
  });

  it("looks at all eight corners", () => {
    expect(corners(box([0, 0, 0], [1, 1, 1]))).toHaveLength(8);
    expect(new Set(corners(box([0, 0, 0], [1, 1, 1])).map(String)).size).toBe(8);
  });

  it("catches a part that only just crosses on a diagonal plane", () => {
    const diagonal: SectionPlane = { origin: [0, 0, 0], normal: [0.577, 0.577, 0.577] };
    const straddling = part("corner", [-1, -1, -1], [1.2, 1.2, 1.2]);

    expect(isCutAway(straddling, diagonal)).toBe(false);
  });
});

describe("trap 3: a part at the assembly's centre does not move", () => {
  const assembly = box([-100, -100, -100], [100, 100, 100]);

  it("leaves it where it is rather than sending it to NaN", () => {
    // Normalising a zero vector is NaN, a NaN translation puts the part nowhere, and
    // nothing raises. On a symmetric machine that part is the main shaft — the one an
    // exploded view exists to show.
    const shaft = part("shaft", [-10, -10, -10], [10, 10, 10]);
    const offset = explodedOffset(shaft, assembly, 1);

    expect(offset).toEqual([0, 0, 0]);
    for (const component of offset) expect(Number.isNaN(component)).toBe(false);
  });

  it("moves an off-centre part outward along its own direction", () => {
    const outer = part("outer", [50, -5, -5], [70, 5, 5]);
    const offset = explodedOffset(outer, assembly, 1);

    expect(offset[0]).toBeGreaterThan(0);
    expect(offset[1]).toBeCloseTo(0, 9);
  });

  it("moves nothing at all when the factor is zero", () => {
    const outer = part("outer", [50, -5, -5], [70, 5, 5]);
    expect(explodedOffset(outer, assembly, 0)).toEqual([0, 0, 0]);
  });

  it("moves a bigger part further, so the machine opens rather than scattering", () => {
    const small = part("small", [50, -1, -1], [52, 1, 1]);
    const large = part("large", [50, -20, -20], [90, 20, 20]);

    const a = explodedOffset(small, assembly, 1);
    const b = explodedOffset(large, assembly, 1);

    expect(Math.hypot(...b)).toBeGreaterThan(Math.hypot(...a));
  });

  it("scales with the factor", () => {
    const outer = part("outer", [50, -5, -5], [70, 5, 5]);
    const half = explodedOffset(outer, assembly, 0.5);
    const full = explodedOffset(outer, assembly, 1);

    expect(full[0]).toBeCloseTo(half[0] * 2, 9);
  });
});

describe("trap 4: hide wins over isolate, and an empty isolate shows nothing", () => {
  const parts = [
    part("m/a", [0, 0, 0], [1, 1, 1]),
    part("m/a/bolt", [0, 0, 0], [1, 1, 1]),
    part("m/b", [0, 0, 0], [1, 1, 1]),
  ];

  it("keeps a hidden part hidden inside the isolated subtree", () => {
    // Hiding is the more specific instruction and the user gave it last.
    const state: ViewState = { ...emptyView(), isolated: "m/a", hidden: ["m/a/bolt"] };

    expect(visibleParts(parts, state).map((p) => p.path)).toEqual(["m/a"]);
  });

  it("shows nothing for an isolated root that is not in the tree", () => {
    // Falling back to the whole machine is the opposite of what isolate asked for, and
    // it looks like the control did nothing.
    const state: ViewState = { ...emptyView(), isolated: "m/nowhere" };

    expect(visibleParts(parts, state)).toEqual([]);
  });

  it("shows the subtree and its descendants", () => {
    const state: ViewState = { ...emptyView(), isolated: "m/a" };

    expect(visibleParts(parts, state).map((p) => p.path)).toEqual(["m/a", "m/a/bolt"]);
  });

  it("shows everything when nothing is isolated or hidden", () => {
    expect(visibleParts(parts, emptyView())).toHaveLength(3);
  });

  it("does not treat a name that merely shares a prefix as a descendant", () => {
    expect(isUnder("m/abc", "m/a")).toBe(false);
    expect(isUnder("m/a/bolt", "m/a")).toBe(true);
    expect(isUnder("m/a", "m/a")).toBe(true);
  });

  it("applies sections on top of hide and isolate", () => {
    const state: ViewState = { ...emptyView(), sections: [CUT_POSITIVE_X] };
    const cut = [part("kept", [-9, 0, 0], [-1, 1, 1]), part("gone", [1, 0, 0], [9, 1, 1])];

    expect(visibleParts(cut, state).map((p) => p.path)).toEqual(["kept"]);
  });
});

describe("a bookmark stores everything the user could see", () => {
  const camera = {
    positionMm: [1, 2, 3] as const,
    targetMm: [0, 0, 0] as const,
    upMm: [0, 0, 1] as const,
  };
  const view: ViewState = {
    sections: [CUT_POSITIVE_X],
    hidden: ["m/bolt"],
    isolated: "m/a",
    explode: 0.4,
  };

  it("carries the sections, the hidden set and the explode factor", () => {
    // A bookmark that stored only the camera restores a solid block where the user saw a
    // bore, or a machine with forty fasteners that were hidden when it was taken.
    const saved = bookmark("section through the bore", camera, view, "2026-09-17T21:00:00Z");

    expect(saved.view.sections).toHaveLength(1);
    expect(saved.view.hidden).toEqual(["m/bolt"]);
    expect(saved.view.isolated).toBe("m/a");
    expect(saved.view.explode).toBe(0.4);
    expect(saved.camera.positionMm).toEqual([1, 2, 3]);
  });

  it("deep-copies on the way in, so later dragging cannot rewrite it", () => {
    const live: ViewState = { ...view, hidden: [...view.hidden] };
    const saved = bookmark("v", camera, live, "2026-09-17T21:00:00Z");

    (live.hidden as string[]).push("m/another");
    (live.sections[0].normal as unknown as number[])[0] = -1;

    expect(saved.view.hidden).toEqual(["m/bolt"]);
    expect(saved.view.sections[0].normal[0]).toBe(1);
  });

  it("deep-copies on the way out, so restoring twice gives two views", () => {
    const saved = bookmark("v", camera, view, "2026-09-17T21:00:00Z");
    const first = restore(saved);

    (first.view.hidden as string[]).push("m/scribble");

    expect(restore(saved).view.hidden).toEqual(["m/bolt"]);
  });

  it("keeps the name and the instant it was taken", () => {
    const saved = bookmark("iso from the left", camera, view, "2026-09-17T21:00:00Z");

    expect(saved.name).toBe("iso from the left");
    expect(saved.takenAt).toBe("2026-09-17T21:00:00Z");
  });

  it("round-trips a view unchanged", () => {
    const saved = bookmark("v", camera, view, "2026-09-17T21:00:00Z");
    expect(restore(saved).view).toEqual(view);
  });
});

describe("the status line counts rather than using adjectives", () => {
  it("says how many of how many are showing", () => {
    // A user who cannot see a part needs to know whether the viewer is hiding it or it
    // is genuinely absent.
    const notes = describeView({ ...emptyView(), hidden: ["a", "b"] }, 10, 8);

    expect(notes.join(" ")).toContain("2 hidden");
    expect(notes.join(" ")).toContain("showing 8 of 10");
  });

  it("says nothing when the view is untouched", () => {
    expect(describeView(emptyView(), 10, 10)).toEqual([]);
  });

  it("reports the explode factor as a percentage", () => {
    expect(describeView({ ...emptyView(), explode: 0.35 }, 3, 3).join(" ")).toContain("35%");
  });

  it("names the isolated subtree", () => {
    expect(describeView({ ...emptyView(), isolated: "m/a" }, 3, 1).join(" ")).toContain("m/a");
  });

  it("pluralises the section count", () => {
    expect(describeView({ ...emptyView(), sections: [CUT_POSITIVE_X] }, 3, 3)[0]).toContain(
      "1 section plane",
    );
  });
});
