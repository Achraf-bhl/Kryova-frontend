import { describe, expect, it } from "vitest";

import {
  distanceToPlane,
  frustumPlanes,
  lookAt,
  multiply,
  perspective,
  sphereInFrustum,
  type Vec3,
} from "./frustum";

/**
 * A 90-degree square view from the origin down -z, near 1, far 100: at depth d the visible
 * half-width is exactly d, which makes every case below a sum a reader can do in their head.
 */
const PLANES = frustumPlanes(multiply(perspective(Math.PI / 2, 1, 1, 100), lookAt([0, 0, 0], [0, 0, -1])));

const inside = (centre: Vec3, radius = 0) => sphereInFrustum(PLANES, centre, radius);

describe("the six planes", () => {
  it("are six, each normalised so d is a distance", () => {
    expect(PLANES).toHaveLength(6);
    for (const [a, b, c] of PLANES) {
      expect(Math.hypot(a, b, c)).toBeCloseTo(1, 12);
    }
  });

  it("put the centre of the view on the inside of every one of them", () => {
    for (const plane of PLANES) {
      expect(distanceToPlane(plane, [0, 0, -10])).toBeGreaterThan(0);
    }
  });

  it("refuse a matrix that is not 4x4", () => {
    expect(() => frustumPlanes([1, 2, 3])).toThrow(/16 entries/);
  });

  it("refuse a degenerate matrix rather than return NaN planes", () => {
    expect(() => frustumPlanes(new Array<number>(16).fill(0))).toThrow(/degenerate/);
  });
});

describe("a sphere against the frustum", () => {
  it("in front and centred is in", () => {
    expect(inside([0, 0, -10], 1)).toBe(true);
  });

  it("behind the camera is out", () => {
    expect(inside([0, 0, 10], 1)).toBe(false);
  });

  it("far off to either side is out, which the half-space test could not say", () => {
    expect(inside([50, 0, -10], 1)).toBe(false);
    expect(inside([-50, 0, -10], 1)).toBe(false);
    expect(inside([0, 50, -10], 1)).toBe(false);
    expect(inside([0, -50, -10], 1)).toBe(false);
  });

  it("beyond the far plane is out, and nearer than the near plane is out", () => {
    expect(inside([0, 0, -200], 1)).toBe(false);
    expect(inside([0, 0, -0.2], 0.1)).toBe(false);
  });

  it("straddling a side plane is in: a part must not pop in as the camera creeps", () => {
    // At z = -10 the half-width is 10; the centre is 1 mm outside but the sphere reaches 1 mm in.
    expect(inside([11, 0, -10], 2)).toBe(true);
    expect(inside([14, 0, -10], 2)).toBe(false);
  });

  it("straddling the far plane is in", () => {
    expect(inside([0, 0, -101], 2)).toBe(true);
  });
});

describe("the camera moves and the planes follow", () => {
  it("a part off to the right comes into view when the camera turns toward it", () => {
    const part: Vec3 = [50, 0, -10];
    expect(inside(part, 1)).toBe(false);
    const turned = frustumPlanes(
      multiply(perspective(Math.PI / 2, 1, 1, 100), lookAt([0, 0, 0], [50, 0, -10])),
    );
    expect(sphereInFrustum(turned, part, 1)).toBe(true);
  });

  it("a wider aspect ratio sees farther sideways", () => {
    const wide = frustumPlanes(
      multiply(perspective(Math.PI / 2, 2, 1, 100), lookAt([0, 0, 0], [0, 0, -1])),
    );
    expect(sphereInFrustum(wide, [15, 0, -10], 0)).toBe(true);
    expect(inside([15, 0, -10], 0)).toBe(false);
  });
});

describe("the matrices", () => {
  it("lookAt puts the target on the camera's -z axis at the right distance", () => {
    const view = lookAt([3, 4, 5], [3, 4, -5]);
    // View-space z of the target is -10: ten units straight ahead.
    const z = view[2] * 3 + view[6] * 4 + view[10] * -5 + view[14];
    expect(z).toBeCloseTo(-10, 12);
  });

  it("multiply by the identity changes nothing", () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const projection = perspective(1, 1.5, 0.1, 50);
    const product = multiply(identity, projection);
    projection.forEach((value, index) => expect(product[index]).toBeCloseTo(value, 12));
  });

  it("perspective refuses a near plane at or behind the camera", () => {
    expect(() => perspective(1, 1, 0, 10)).toThrow(/0 < near < far/);
    expect(() => perspective(1, 1, 10, 5)).toThrow(/0 < near < far/);
  });
});
