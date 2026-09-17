import { describe, expect, it } from "vitest";

import {
  COARSEST_LEVEL,
  LEVEL_SCREEN_PX,
  MIN_SCREEN_PX,
  compareRequests,
  isInFront,
  levelFor,
  plan,
  screenSizePx,
  wantedFor,
  type Camera,
  type ScenePart,
} from "./scene-streaming";

/**
 * P6 task 2's ordering, tested as arithmetic.
 *
 * This file and the module beside it were claimed by the master plan on 2026-09-15 and
 * had never existed — `git log --all` over the path was empty on 2026-09-17. The design
 * survived in the status line that claimed them, and these tests hold the rebuild to it
 * decision by decision, because a design described in prose and never executed is exactly
 * what produced the false claim in the first place.
 */

const CAMERA: Camera = {
  positionMm: [0, 0, 0],
  directionMm: [0, 0, 1],
  viewportPx: 1080,
  fovRad: 1.0,
};

function partAt(path: string, z: number, radiusMm = 50, level: number | null = null): ScenePart {
  return { path, centreMm: [0, 0, z], radiusMm, level };
}

describe("apparent size", () => {
  it("halves when the distance doubles", () => {
    const near = screenSizePx(partAt("a", 1000), CAMERA);
    const far = screenSizePx(partAt("a", 2000), CAMERA);

    expect(far).toBeCloseTo(near / 2, 6);
  });

  it("is infinite for a part containing the camera", () => {
    // Not a clamped large number: it is the truthful answer, and the comparator is
    // written to handle it. A part the camera is inside must load first.
    expect(screenSizePx(partAt("inside", 10, 50), CAMERA)).toBe(Number.POSITIVE_INFINITY);
  });

  it("grows with the viewport, because a ratio is not a size", () => {
    const small = screenSizePx(partAt("a", 1000), { ...CAMERA, viewportPx: 540 });
    const large = screenSizePx(partAt("a", 1000), { ...CAMERA, viewportPx: 1080 });

    expect(large).toBeCloseTo(small * 2, 6);
  });

  it("shrinks as the field of view widens", () => {
    const narrow = screenSizePx(partAt("a", 1000), { ...CAMERA, fovRad: 0.5 });
    const wide = screenSizePx(partAt("a", 1000), { ...CAMERA, fovRad: 1.0 });

    expect(wide).toBeCloseTo(narrow / 2, 6);
  });
});

describe("levels are in part radii, not millimetres", () => {
  it("gives a nut and a weldment the same level at the same screen size", () => {
    // Decision 1, and the failure it prevents: a millimetre threshold would load the
    // weldment at its coarsest level from across the room and the nut at its finest from
    // the same place. Here a 3 mm nut at 60 mm and a 2 m weldment at 40 m are the same
    // fraction of the screen, so they deserve the same mesh.
    const nut = partAt("nut", 60, 3);
    const weldment = partAt("weldment", 40_000, 2_000);

    expect(screenSizePx(nut, CAMERA)).toBeCloseTo(screenSizePx(weldment, CAMERA), 6);
    expect(levelFor(screenSizePx(nut, CAMERA))).toBe(
      levelFor(screenSizePx(weldment, CAMERA)),
    );
  });

  it("earns each level at its own threshold", () => {
    expect(levelFor(LEVEL_SCREEN_PX[0])).toBe(0);
    expect(levelFor(LEVEL_SCREEN_PX[0] - 1)).toBe(1);
    expect(levelFor(LEVEL_SCREEN_PX[1])).toBe(1);
    expect(levelFor(LEVEL_SCREEN_PX[1] - 1)).toBe(COARSEST_LEVEL);
  });

  it("gives nothing at all below the cutoff", () => {
    expect(levelFor(MIN_SCREEN_PX - 0.001)).toBeNull();
    expect(levelFor(MIN_SCREEN_PX)).toBe(COARSEST_LEVEL);
  });
});

describe("a part is never fetched at a worse level than it holds", () => {
  it("leaves a part that is already finer than it deserves", () => {
    // Decision 2. Flying away from a machine must never spend a round trip on a worse
    // mesh, so the level a part holds is a high-water mark.
    const far = partAt("held", 100_000, 50, 0);

    expect(wantedFor(far, CAMERA)).toBeNull();
  });

  it("improves a part that is coarser than it deserves", () => {
    const near = partAt("held", 500, 50, COARSEST_LEVEL);
    const request = wantedFor(near, CAMERA);

    expect(request).not.toBeNull();
    expect(request?.level).toBeLessThan(COARSEST_LEVEL);
  });

  it("leaves a part already at the level it deserves", () => {
    const part = partAt("held", 1000, 50);
    const deserved = levelFor(screenSizePx(part, CAMERA));

    expect(wantedFor({ ...part, level: deserved }, CAMERA)).toBeNull();
  });

  it("asks for nothing for a part under the cutoff, however coarse it is", () => {
    expect(wantedFor(partAt("speck", 5_000_000, 50), CAMERA)).toBeNull();
  });
});

describe("culling is a half-space, and says so", () => {
  it("drops a part behind the camera", () => {
    expect(isInFront(partAt("behind", -5000, 50), CAMERA)).toBe(false);
    expect(wantedFor(partAt("behind", -5000, 50), CAMERA)).toBeNull();
  });

  it("keeps a part straddling the camera plane", () => {
    // Its centre is behind and half of it is visible. Popping in as the camera creeps
    // forward is worse than fetching a few parts early.
    expect(isInFront(partAt("straddle", -10, 50), CAMERA)).toBe(true);
  });

  it("keeps a part outside the viewport but in front, and that is the stated cost", () => {
    // Decision 4: no projection matrix here, so "off to the side" is not expressible.
    const offToTheSide: ScenePart = {
      path: "aside",
      centreMm: [50_000, 0, 1000],
      radiusMm: 50,
      level: null,
    };

    expect(isInFront(offToTheSide, CAMERA)).toBe(true);
  });
});

describe("the comparator is total", () => {
  it("orders two parts containing the camera rather than returning NaN", () => {
    // Decision 5, and the whole reason this is not written as `b.screenPx - a.screenPx`:
    // `Infinity - Infinity` is NaN, and a NaN comparator leaves the order to the engine —
    // a viewer that loads something different first on every frame.
    const a = { path: "a", level: 0, screenPx: Number.POSITIVE_INFINITY };
    const b = { path: "b", level: 0, screenPx: Number.POSITIVE_INFINITY };

    expect(compareRequests(a, b)).toBe(-1);
    expect(compareRequests(b, a)).toBe(1);
    expect(Number.isNaN(compareRequests(a, b))).toBe(false);
  });

  it("is antisymmetric and reflexive on equal sizes", () => {
    const a = { path: "a", level: 1, screenPx: 100 };
    const b = { path: "b", level: 1, screenPx: 100 };

    expect(compareRequests(a, a)).toBe(0);
    expect(compareRequests(a, b)).toBe(-compareRequests(b, a));
  });

  it("puts the bigger part first", () => {
    const big = { path: "z", level: 0, screenPx: 900 };
    const small = { path: "a", level: 2, screenPx: 9 };

    expect(compareRequests(big, small)).toBe(-1);
  });
});

describe("planning a whole scene", () => {
  const scene: ScenePart[] = [
    partAt("far", 100_000, 50),
    partAt("near", 400, 50),
    partAt("behind", -4000, 50),
    partAt("middle", 4000, 50),
  ];

  it("returns the visible parts biggest first", () => {
    const order = plan(scene, CAMERA).map((request) => request.path);

    expect(order[0]).toBe("near");
    expect(order).not.toContain("behind");
  });

  it("is deterministic across repeated calls", () => {
    // The property the whole module exists for: a viewer that reorders between frames
    // loads a different part first every time and never finishes the important ones.
    const first = plan(scene, CAMERA).map((r) => r.path);
    const second = plan([...scene].reverse(), CAMERA).map((r) => r.path);

    expect(second).toEqual(first);
  });

  it("takes the best N rather than the first N found", () => {
    const limited = plan(scene, CAMERA, 1);

    expect(limited).toHaveLength(1);
    expect(limited[0].path).toBe("near");
  });

  it("returns nothing for a limit of zero, rather than everything", () => {
    expect(plan(scene, CAMERA, 0)).toEqual([]);
  });

  it("returns an empty plan for an empty scene", () => {
    expect(plan([], CAMERA)).toEqual([]);
  });

  it("drops most of a machine-scale scene, which is the point", () => {
    // Decision 3 at scale: on an assembly, most parts are under eight pixels from any
    // view that shows the whole machine, and not fetching them is the biggest single
    // saving available.
    const machine: ScenePart[] = Array.from({ length: 2000 }, (_, index) => ({
      path: `machine/part_${index}`,
      centreMm: [(index % 50) * 300, Math.floor(index / 50) * 300, 30_000],
      radiusMm: 25,
      level: null,
    }));

    const wanted = plan(machine, CAMERA);

    expect(wanted.length).toBeLessThan(machine.length / 2);
  });
});
