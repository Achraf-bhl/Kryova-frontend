import { describe, expect, it } from "vitest";

import {
  type BoundingBox,
  type Camera,
  DEFAULT_LOD,
  MIN_PIXELS_FOR_A_MESH,
  type ScenePart,
  isAhead,
  lodFor,
  planLoads,
  priority,
  radius,
  screenHeightPx,
} from "./scene-streaming";

/**
 * Streaming order for a machine-scale assembly (master plan P6.2).
 *
 * The claims worth pinning are the ones where a plausible implementation is
 * quietly wrong rather than broken: a scene that thrashes when the camera backs
 * away, a viewer that spends its first second on fasteners, a cull that pops a
 * hole in the foreground, and a sort that is not total. None of those throws.
 *
 * Written on Linux and **not run** (the user's rule; Windows runs them).
 */

function bb(
  min: [number, number, number],
  max: [number, number, number],
): BoundingBox {
  return { min, max };
}

function box(x: number, size = 10): BoundingBox {
  return bb([x, 0, 0], [x + size, size, size]);
}

const camera: Camera = {
  position: [0, 5, 500],
  direction: [0, 0, -1],
  fovY: Math.PI / 4,
  viewportHeightPx: 1000,
};

describe("geometry helpers", () => {
  it("takes the radius as half the body diagonal", () => {
    expect(radius(bb([0, 0, 0], [2, 0, 0]))).toBe(1);
  });

  it("reports a part containing the camera as infinitely large", () => {
    const around: BoundingBox = bb([-1000, -1000, -1000], [1000, 1000, 1000]);

    expect(screenHeightPx(camera, around)).toBe(Number.POSITIVE_INFINITY);
  });

  it("a nearer part of the same size is larger on screen", () => {
    const near = bb([0, 0, 0], [10, 10, 10]);
    const far = bb([0, 0, -2000], [10, 10, -1990]);

    expect(screenHeightPx(camera, near)).toBeGreaterThan(screenHeightPx(camera, far));
  });
});

describe("what is behind the camera", () => {
  it("culls a part well behind it", () => {
    expect(isAhead(camera, bb([0, 0, 900], [10, 10, 910]))).toBe(false);
  });

  it("keeps a part straddling the camera plane", () => {
    /* Culling on the centre alone pops a hole in the foreground as you walk
       into an assembly, which is exactly when a viewer must not flicker. */
    const straddling: BoundingBox = bb([-50, -50, 450], [50, 50, 550]);

    expect(isAhead(camera, straddling)).toBe(true);
  });

  it("orders anything in front above anything behind", () => {
    const behind: ScenePart = { id: "behind", box: bb([0, 0, 900], [400, 400, 1300]) };
    const ahead: ScenePart = { id: "ahead", box: box(0, 1) };

    expect(priority(camera, ahead)).toBeGreaterThan(priority(camera, behind));
  });

  it("gives a total order, so a sort is stable across passes", () => {
    /* `Infinity - Infinity` is NaN, and a comparator returning NaN leaves the
       order to the engine — which is a viewer that loads a different thing
       first on every frame. */
    const huge: ScenePart = { id: "a", box: bb([-1e4, -1e4, -1e4], [1e4, 1e4, 1e4]) };
    const also: ScenePart = { id: "b", box: bb([-1e4, -1e4, -1e4], [1e4, 1e4, 1e4]) };

    expect(priority(camera, huge) - priority(camera, also)).toBe(0);
  });
});

describe("detail level", () => {
  it("is measured in part radii, so one table serves a nut and a frame", () => {
    /* A threshold in millimetres would load a 2 m weldment at its coarsest
       level from across the room and a M6 nut at its finest. */
    const nut = bb([0, 0, 0], [6, 6, 6]);
    const frame = bb([0, 0, 0], [2000, 2000, 2000]);
    const close: Camera = { ...camera, position: [0, 0, 0] };

    expect(lodFor(close, nut)).toBe(lodFor(close, frame));
  });

  it("gives the finest level up close and the coarsest far away", () => {
    const part = bb([0, 0, 0], [10, 10, 10]);
    const near: Camera = { ...camera, position: [5, 5, 20] };
    const far: Camera = { ...camera, position: [5, 5, 5000] };

    expect(lodFor(near, part)).toBe(2);
    expect(lodFor(far, part)).toBe(0);
  });

  it("does not divide by zero on a degenerate part", () => {
    expect(lodFor(camera, bb([1, 1, 1], [1, 1, 1]))).toBe(0);
  });

  it("switches at the stated thresholds", () => {
    const part = bb([-1, -1, -1], [1, 1, 1]);
    const r = radius(part);
    const at = (radii: number): Camera => ({ ...camera, position: [0, 0, radii * r] });

    expect(lodFor(at(DEFAULT_LOD.fine - 0.1), part)).toBe(2);
    expect(lodFor(at(DEFAULT_LOD.fine + 0.1), part)).toBe(1);
    expect(lodFor(at(DEFAULT_LOD.medium + 0.1), part)).toBe(0);
  });
});

describe("planning what to fetch", () => {
  it("asks for the biggest thing on screen first", () => {
    const parts: ScenePart[] = [
      { id: "washer", box: bb([0, 0, 0], [3, 3, 1]) },
      { id: "frame", box: bb([-200, -200, -50], [200, 200, 50]) },
    ];

    expect(planLoads(camera, parts)[0].id).toBe("frame");
  });

  it("does not fetch a mesh for something too small to see", () => {
    /* On an assembly this is most of the parts, and it is the difference
       between streaming a machine and streaming its fasteners. */
    const speck: ScenePart = { id: "speck", box: bb([0, 0, 0], [0.2, 0.2, 0.2]) };

    expect(planLoads(camera, [speck])).toEqual([]);
    expect(screenHeightPx(camera, speck.box)).toBeLessThan(MIN_PIXELS_FOR_A_MESH);
  });

  it("plans nothing for a settled scene", () => {
    const parts: ScenePart[] = [
      { id: "frame", box: bb([-200, -200, -50], [200, 200, 50]), loaded: 2 },
    ];

    expect(planLoads(camera, parts)).toEqual([]);
  });

  it("does not re-fetch a coarser mesh when the camera backs away", () => {
    /* The thrash this module exists to avoid: flying away from a part must not
       spend a round trip to replace a mesh already in memory with a worse one. */
    const far: Camera = { ...camera, position: [0, 0, 100_000] };
    const parts: ScenePart[] = [
      { id: "frame", box: bb([-2000, -2000, -2000], [2000, 2000, 2000]), loaded: 2 },
    ];

    expect(planLoads(far, parts)).toEqual([]);
  });

  it("does upgrade a part that has only a coarse mesh", () => {
    const parts: ScenePart[] = [
      { id: "frame", box: bb([-200, -200, -50], [200, 200, 50]), loaded: 0 },
    ];

    expect(planLoads(camera, parts)).toEqual([{ id: "frame", level: 2 }]);
  });

  it("treats a part with no mesh as needing one", () => {
    const parts: ScenePart[] = [
      { id: "frame", box: bb([-200, -200, -50], [200, 200, 50]) },
    ];

    expect(planLoads(camera, parts)).toHaveLength(1);
  });

  it("honours the budget", () => {
    const parts: ScenePart[] = Array.from({ length: 50 }, (_, index) => ({
      id: `p${index}`,
      box: bb([index * 20, 0, 0], [index * 20 + 15, 15, 15]),
    }));

    expect(planLoads(camera, parts, { budget: 5 })).toHaveLength(5);
  });

  it("breaks ties by id so two passes agree", () => {
    const parts: ScenePart[] = [
      { id: "b", box: bb([-100, -100, 0], [100, 100, 10]) },
      { id: "a", box: bb([-100, -100, 0], [100, 100, 10]) },
    ];

    expect(planLoads(camera, parts).map((one) => one.id)).toEqual(["a", "b"]);
  });

  it("never asks for a part behind the camera", () => {
    const parts: ScenePart[] = [
      { id: "behind", box: bb([-400, -400, 900], [400, 400, 1300]) },
    ];

    expect(planLoads(camera, parts)).toEqual([]);
  });
});
