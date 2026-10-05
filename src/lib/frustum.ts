/**
 * The six-plane view frustum, and a sphere test against it — ROAD_TO_10 6.9.
 *
 * `scene-streaming.ts` culls with a half-space and says why (decision 4): a full frustum needs
 * the projection matrix, which belongs to the renderer. This module is the renderer's half. A
 * caller that has the camera's view-projection matrix gets the other five planes, and a part
 * that is in front of the camera but off to the side — fetched late by the half-space test —
 * is not fetched at all.
 *
 * Pure arithmetic over a column-major 4x4 (WebGL's layout, `m[col * 4 + row]`), no GL context,
 * so the part worth testing is testable. The planes are extracted from the combined matrix
 * (Gribb and Hartmann): each is a row of it added to or subtracted from the fourth row, which
 * holds because a point is inside the clip volume exactly when `-w <= x, y, z <= w`.
 *
 * Conventions that are easy to get wrong, all stated here and pinned by tests:
 * - **A point is inside a plane when `a·x + b·y + c·z + d >= 0`**, the planes normalised so
 *   `d` is a distance. An unnormalised plane would make "within a radius of the plane" depend
 *   on how the matrix was scaled.
 * - **Depth is OpenGL's `-w..w`**, not Direct3D's `0..w`. A WebGL projection built the usual
 *   way is the former; a matrix built for the latter would put the near plane at the wrong
 *   place, and nothing but a part vanishing at close range would show it.
 */

/** `[a, b, c, d]` of the plane `a·x + b·y + c·z + d = 0`, normal pointing into the frustum. */
export type Plane = readonly [number, number, number, number];

export type Vec3 = readonly [number, number, number];

/** The left, right, bottom, top, near and far planes of a column-major view-projection matrix. */
export function frustumPlanes(viewProjection: ArrayLike<number>): Plane[] {
  if (viewProjection.length !== 16) {
    throw new Error(`A view-projection matrix has 16 entries; got ${viewProjection.length}.`);
  }
  const m = viewProjection;
  const row = (index: number): [number, number, number, number] => [
    m[index],
    m[4 + index],
    m[8 + index],
    m[12 + index],
  ];
  const w = row(3);
  const combine = (axis: number, sign: 1 | -1): Plane => {
    const r = row(axis);
    return normalise([
      w[0] + sign * r[0],
      w[1] + sign * r[1],
      w[2] + sign * r[2],
      w[3] + sign * r[3],
    ]);
  };
  return [
    combine(0, 1), // left
    combine(0, -1), // right
    combine(1, 1), // bottom
    combine(1, -1), // top
    combine(2, 1), // near
    combine(2, -1), // far
  ];
}

function normalise(plane: [number, number, number, number]): Plane {
  const length = Math.hypot(plane[0], plane[1], plane[2]);
  if (!(length > 0)) {
    throw new Error("A frustum plane has no direction: the matrix is degenerate.");
  }
  return [plane[0] / length, plane[1] / length, plane[2] / length, plane[3] / length];
}

/** Signed distance from a point to a plane: positive on the inside. */
export function distanceToPlane(plane: Plane, point: Vec3): number {
  return plane[0] * point[0] + plane[1] * point[1] + plane[2] * point[2] + plane[3];
}

/**
 * Whether a sphere is at least partly inside the frustum.
 *
 * Conservative in the right direction: a sphere touching a plane, or straddling it, is *in* — a
 * part that pops into view as the camera moves is worse than one fetched a frame early. It is
 * also conservative the other way near the corners (a sphere can be outside no single plane and
 * still miss the frustum), which costs a fetch and never a missing part.
 */
export function sphereInFrustum(planes: readonly Plane[], centre: Vec3, radius: number): boolean {
  for (const plane of planes) {
    if (distanceToPlane(plane, centre) < -radius) return false;
  }
  return true;
}

// -- the matrices a caller needs to build one --------------------------------------------

/** Column-major `a · b`: apply `b` first. */
export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** An OpenGL perspective projection: `-w..w` depth, the camera looking down its own -z. */
export function perspective(fovYRad: number, aspect: number, near: number, far: number): number[] {
  if (!(near > 0) || !(far > near)) {
    throw new Error("A projection needs 0 < near < far.");
  }
  const f = 1 / Math.tan(fovYRad / 2);
  const out = new Array<number>(16).fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

/** A view matrix for a camera at `eye` looking at `target`, with `up` roughly upward. */
export function lookAt(eye: Vec3, target: Vec3, up: Vec3 = [0, 1, 0]): number[] {
  const f = unit([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const s = unit(cross(f, up));
  const u = cross(s, f);
  return [
    s[0], u[0], -f[0], 0,
    s[1], u[1], -f[1], 0,
    s[2], u[2], -f[2], 0,
    -dot3(s, eye), -dot3(u, eye), dot3(f, eye), 1,
  ]; // prettier-ignore
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(v: Vec3): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!(length > 0)) throw new Error("A camera cannot look along a zero vector.");
  return [v[0] / length, v[1] / length, v[2] / length];
}
