import { describe, expect, it } from "vitest";

import type { BoundingBox } from "./scene-streaming";
import {
  NOTHING_HIDDEN,
  type SceneNode,
  type SectionPlane,
  type Vec3,
  type ViewState,
  assemblyCentre,
  bookmarkView,
  bookmarksFor,
  clipsPoint,
  explodeOffsets,
  midPlane,
  restoreView,
  sideOf,
  sideOfAll,
  signedDistance,
  subtree,
  visible,
} from "./viewer-interactions";

/**
 * Section planes, explode, hide/isolate and bookmarks (master plan P6.4).
 *
 * Every claim here is one where a plausible implementation is silently wrong
 * rather than broken: a section that drops a part it should have clipped, an
 * explode that sends the main shaft to `NaN`, an isolate that un-hides what the
 * user hid, and a bookmark that restores a camera onto a different machine.
 * None of those throws.
 *
 * Written on Linux and **not run** (the user's rule; Windows runs them).
 */

function bb(min: Vec3, max: Vec3): BoundingBox {
  return { min, max };
}

const CUBE = bb([-10, -10, -10], [10, 10, 10]);

describe("a section plane's normal points at what is removed", () => {
  /* catia_split's convention and app/render/section.py's. Two conventions for
     one question is how a part ends up mirrored with every test green. */
  const plane: SectionPlane = { normal: [0, 0, 1], offset: 0, enabled: true };

  it("removes what is on the normal's side", () => {
    expect(clipsPoint(plane, [0, 0, 5])).toBe(true);
    expect(clipsPoint(plane, [0, 0, -5])).toBe(false);
  });

  it("measures the distance in millimetres whatever the normal's length", () => {
    const long: SectionPlane = { normal: [0, 0, 7], offset: 0, enabled: true };

    expect(signedDistance(long, [0, 0, 5])).toBeCloseTo(5, 9);
  });

  it("offsets along the normal, not along an axis", () => {
    const tilted: SectionPlane = { normal: [1, 1, 0], offset: 0, enabled: true };

    expect(signedDistance(tilted, [1, 1, 0])).toBeCloseTo(Math.SQRT2, 9);
  });

  it("cuts nothing when it is disabled", () => {
    expect(clipsPoint({ ...plane, enabled: false }, [0, 0, 5])).toBe(false);
  });

  it("treats a zero normal as cutting nothing rather than everything", () => {
    /* It is not a plane. Reading NaN as "removed" would empty the viewport. */
    const degenerate: SectionPlane = { normal: [0, 0, 0], offset: 0, enabled: true };

    expect(clipsPoint(degenerate, [0, 0, 5])).toBe(false);
    expect(sideOf(degenerate, CUBE)).toBe("kept");
  });
});

describe("which side a whole part is on", () => {
  const plane: SectionPlane = { normal: [0, 0, 1], offset: 0, enabled: true };

  it("keeps a part entirely behind the cut", () => {
    expect(sideOf(plane, bb([-1, -1, -50], [1, 1, -40]))).toBe("kept");
  });

  it("removes a part entirely past it", () => {
    expect(sideOf(plane, bb([-1, -1, 40], [1, 1, 50]))).toBe("removed");
  });

  it("calls a part through the cut crossing, so it is clipped and not dropped", () => {
    /* Testing the centre alone makes a long member through the cut vanish from
       the section view while still being in the part. */
    expect(sideOf(plane, CUBE)).toBe("crossing");
  });

  it("tests corners, so a part whose centre is kept but whose end is not still crosses", () => {
    expect(sideOf(plane, bb([-1, -1, -30], [1, 1, 1]))).toBe("crossing");
  });

  it("intersects several planes, which is what three sliders mean", () => {
    const x: SectionPlane = { normal: [1, 0, 0], offset: 0, enabled: true };
    const z: SectionPlane = { normal: [0, 0, 1], offset: 0, enabled: true };
    const corner = bb([5, 5, 5], [9, 9, 9]);

    expect(sideOfAll([x, z], corner)).toBe("removed");
    expect(sideOfAll([x, z], bb([-9, -9, -9], [-5, -5, -5]))).toBe("kept");
  });

  it("is kept when every plane is disabled", () => {
    expect(sideOfAll([{ ...plane, enabled: false }], CUBE)).toBe("kept");
  });

  it("cuts a mid-plane through the middle of the box", () => {
    const offset = bb([0, 0, 0], [100, 10, 10]);

    expect(midPlane(offset, "x").offset).toBe(50);
    expect(midPlane(offset, "x").normal).toEqual([1, 0, 0]);
  });
});

describe("exploding an assembly", () => {
  const nodes: SceneNode[] = [
    { id: "left", parent: null, box: bb([-30, -5, -5], [-20, 5, 5]) },
    { id: "right", parent: null, box: bb([20, -5, -5], [30, 5, 5]) },
  ];

  it("is the identity at factor zero, so the animation starts assembled", () => {
    const offsets = explodeOffsets(nodes, 0);

    expect(offsets.get("left")).toEqual([0, 0, 0]);
    expect(offsets.get("right")).toEqual([0, 0, 0]);
  });

  it("moves each component radially outward from the assembly's centre", () => {
    const offsets = explodeOffsets(nodes, 1);

    expect(offsets.get("left")?.[0]).toBeCloseTo(-25, 9);
    expect(offsets.get("right")?.[0]).toBeCloseTo(25, 9);
  });

  it("scales with the factor, so an animation is a lerp", () => {
    const half = explodeOffsets(nodes, 0.5).get("right") as Vec3;
    const full = explodeOffsets(nodes, 1).get("right") as Vec3;

    expect(half[0]).toBeCloseTo(full[0] / 2, 9);
  });

  it("leaves a part centred on the assembly's centre where it is", () => {
    /* Normalising a zero vector is NaN, and a NaN translation puts the part at
       no position at all — it disappears with nothing raising. On a symmetric
       machine that part is the main shaft. */
    const withShaft: SceneNode[] = [...nodes, { id: "shaft", parent: null, box: CUBE }];
    const offset = explodeOffsets(withShaft, 3).get("shaft") as Vec3;

    expect(offset).toEqual([0, 0, 0]);
    expect(offset.every((one) => Number.isFinite(one))).toBe(true);
  });

  it("plans nothing for an empty assembly", () => {
    expect(explodeOffsets([], 1).size).toBe(0);
  });

  it("takes the centre of everything, not of the first thing", () => {
    expect(assemblyCentre(nodes)).toEqual([0, 0, 0]);
  });
});

describe("hide and isolate by subtree", () => {
  /* frame > [gearbox > [housing, gears], motor] */
  const nodes: SceneNode[] = [
    { id: "frame", parent: null, box: CUBE },
    { id: "gearbox", parent: "frame", box: CUBE },
    { id: "housing", parent: "gearbox", box: CUBE },
    { id: "gears", parent: "gearbox", box: CUBE },
    { id: "motor", parent: "frame", box: CUBE },
  ];

  it("takes a whole subtree, including its root", () => {
    expect(subtree(nodes, "gearbox")).toEqual(new Set(["gearbox", "housing", "gears"]));
  });

  it("shows everything by default", () => {
    expect(visible(nodes, NOTHING_HIDDEN).size).toBe(nodes.length);
  });

  it("hiding a subtree hides its children too", () => {
    const shown = visible(nodes, { hiddenRoots: ["gearbox"], isolatedRoot: null });

    expect(shown).toEqual(new Set(["frame", "motor"]));
  });

  it("isolating a subtree shows only it", () => {
    const shown = visible(nodes, { hiddenRoots: [], isolatedRoot: "gearbox" });

    expect(shown).toEqual(new Set(["gearbox", "housing", "gears"]));
  });

  it("hide wins over isolate, which is the point of doing both", () => {
    /* Isolating a gearbox and then hiding its housing must leave the gears
       showing. The opposite rule reads as the viewer forgetting an instruction. */
    const shown = visible(nodes, { hiddenRoots: ["housing"], isolatedRoot: "gearbox" });

    expect(shown).toEqual(new Set(["gearbox", "gears"]));
  });

  it("isolating something that is not in the tree shows nothing, never everything", () => {
    /* The user asked to see one thing; showing them the whole machine instead is
       indistinguishable from the isolate not having worked. */
    expect(visible(nodes, { hiddenRoots: [], isolatedRoot: "flywheel" }).size).toBe(0);
  });

  it("does not hang on a cycle a malformed structure could carry", () => {
    const looped: SceneNode[] = [
      { id: "a", parent: "b", box: CUBE },
      { id: "b", parent: "a", box: CUBE },
    ];

    expect(subtree(looped, "a")).toEqual(new Set(["a", "b"]));
  });
});

describe("a bookmark is the view, not the camera", () => {
  const state: ViewState = {
    camera: { position: [0, 0, 100], target: [0, 0, 0], up: [0, 1, 0] },
    sections: [{ normal: [0, 0, 1], offset: 5, enabled: true }],
    visibility: { hiddenRoots: ["fasteners"], isolatedRoot: null },
    explodeFactor: 0.4,
  };
  const label = {
    id: "bm1",
    name: "the cracked corner",
    conversationId: "conv-1",
    savedAt: "2026-09-16T10:00:00Z",
  };

  it("carries the sections, or it restores a solid block where there was a bore", () => {
    const saved = bookmarkView(state, label);

    expect(saved.sections).toEqual(state.sections);
    expect(saved.explodeFactor).toBe(0.4);
    expect(saved.visibility.hiddenRoots).toEqual(["fasteners"]);
  });

  it("copies rather than referencing, so dragging a slider cannot rewrite it", () => {
    const sections: SectionPlane[] = [{ normal: [0, 0, 1], offset: 5, enabled: true }];
    const saved = bookmarkView({ ...state, sections }, label);

    sections[0].offset = 99;

    expect(saved.sections[0].offset).toBe(5);
  });

  it("copies the camera too", () => {
    const camera = { position: [0, 0, 100] as Vec3, target: [0, 0, 0] as Vec3, up: [0, 1, 0] as Vec3 };
    const saved = bookmarkView({ ...state, camera }, label);

    camera.position[2] = 999;

    expect(saved.camera.position[2]).toBe(100);
  });

  it("restores what it saved", () => {
    const restored = restoreView(bookmarkView(state, label));

    expect(restored.camera).toEqual(state.camera);
    expect(restored.sections).toEqual(state.sections);
    expect(restored.visibility).toEqual(state.visibility);
    expect(restored.explodeFactor).toBe(state.explodeFactor);
  });

  it("restoring hands back a copy, so restoring twice gives two views", () => {
    const saved = bookmarkView(state, label);
    const first = restoreView(saved);
    first.sections[0].offset = 99;

    expect(restoreView(saved).sections[0].offset).toBe(5);
  });
});

describe("bookmarks belong to a conversation", () => {
  const make = (id: string, conversationId: string, savedAt: string) =>
    bookmarkView(
      {
        camera: { position: [0, 0, 1], target: [0, 0, 0], up: [0, 1, 0] },
        sections: [],
        visibility: NOTHING_HIDDEN,
        explodeFactor: 0,
      },
      { id, name: id, conversationId, savedAt },
    );

  it("lists only this conversation's, because that is what the name means", () => {
    const all = [
      make("a", "conv-1", "2026-09-16T10:00:00Z"),
      make("b", "conv-2", "2026-09-16T11:00:00Z"),
    ];

    expect(bookmarksFor(all, "conv-1").map((one) => one.id)).toEqual(["a"]);
  });

  it("puts the newest first", () => {
    const all = [
      make("old", "conv-1", "2026-09-16T10:00:00Z"),
      make("new", "conv-1", "2026-09-16T12:00:00Z"),
    ];

    expect(bookmarksFor(all, "conv-1").map((one) => one.id)).toEqual(["new", "old"]);
  });

  it("breaks a tie on id, so two renders agree", () => {
    const all = [
      make("b", "conv-1", "2026-09-16T10:00:00Z"),
      make("a", "conv-1", "2026-09-16T10:00:00Z"),
    ];

    expect(bookmarksFor(all, "conv-1").map((one) => one.id)).toEqual(["a", "b"]);
  });
});
