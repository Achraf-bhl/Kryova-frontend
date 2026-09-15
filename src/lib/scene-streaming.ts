/**
 * Which part to fetch next, and at which detail (master plan P6.2).
 *
 * The viewer's problem at machine scale is not drawing — it is *ordering*. A
 * 2,000-part assembly cannot be fetched at once, so something has to decide what
 * arrives first, and the difference between a viewer that feels instant and one
 * that feels broken is entirely in that decision. Getting it wrong is not a
 * crash: it is a user staring at an empty viewport while the machine loads forty
 * washers behind the frame.
 *
 * This module is that decision and nothing else. It is pure arithmetic over
 * bounding boxes and a camera — no WebGL, no fetch, no React — for the reason
 * `app/design/` is pure in the backend: the ordering is the part worth testing,
 * and it is untestable once it is tangled with a GL context and a network.
 *
 * **Structure first is a consequence, not a special case.** A part with no mesh
 * yet still has a bounding box from the tree, so it is drawn as a box and
 * ordered like anything else. There is no separate "structure phase" to get out
 * of step with the streaming one.
 *
 * **No dependency.** The frontend has three runtime dependencies by doctrine,
 * and vector arithmetic on axis-aligned boxes is thirty lines. Pulling in a
 * matrix library for this would be a named decision in the master plan, and it
 * would not be worth making.
 */

/** An axis-aligned box in model space, millimetres — the backend's units. */
export interface BoundingBox {
  min: [number, number, number];
  max: [number, number, number];
}

/** What the viewer knows about one part before its mesh has arrived. */
export interface ScenePart {
  id: string;
  box: BoundingBox;
  /** Detail level already loaded, or `null` when only the box is known. */
  loaded?: DetailLevel | null;
}

/**
 * The three levels `GET /projects/{id}/geometry/{n}/display?level=` serves.
 *
 * Numbered rather than named so "coarser" is `<` and the comparison needs no
 * lookup table: 0 is the coarsest and 2 the finest, matching the route.
 */
export type DetailLevel = 0 | 1 | 2;

export interface Camera {
  position: [number, number, number];
  /** Unit-length view direction. Not normalised here — the caller owns its own maths. */
  direction: [number, number, number];
  /** Vertical field of view, radians. */
  fovY: number;
  /** Viewport height in pixels, which is what makes the answer a *screen* size. */
  viewportHeightPx: number;
}

/**
 * Distance in **part radii** at which each level stops being worth its bytes.
 *
 * Expressed in radii rather than millimetres so one table serves a washer and a
 * press frame: a threshold in millimetres would load a 2 m weldment at its
 * coarsest level from across the room and a M6 nut at its finest.
 */
export interface LodThresholds {
  /** Closer than this many radii: the finest level. */
  fine: number;
  /** Closer than this many radii: the middle level. Beyond it, the coarsest. */
  medium: number;
}

export const DEFAULT_LOD: LodThresholds = { fine: 4, medium: 12 };

/**
 * Below this many pixels, a part is not worth a mesh at all and stays a box.
 *
 * A part smaller than a few pixels is indistinguishable from its own bounding
 * box on screen, so fetching its mesh spends bandwidth on something the user
 * cannot see — and on an assembly it is most of the parts.
 */
export const MIN_PIXELS_FOR_A_MESH = 8;

export function centre(box: BoundingBox): [number, number, number] {
  return [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
}

/** Half the body diagonal: the radius of the sphere that contains the box. */
export function radius(box: BoundingBox): number {
  const dx = box.max[0] - box.min[0];
  const dy = box.max[1] - box.min[1];
  const dz = box.max[2] - box.min[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz) / 2;
}

export function distanceTo(camera: Camera, box: BoundingBox): number {
  const c = centre(box);
  const dx = c[0] - camera.position[0];
  const dy = c[1] - camera.position[1];
  const dz = c[2] - camera.position[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * How many pixels tall this part is, roughly.
 *
 * The standard projected-sphere estimate: a sphere of radius r at distance d
 * subtends about `2r/d` radians, and the viewport covers `fovY` radians over
 * `viewportHeightPx` pixels. It is an estimate — a long part seen end-on is
 * overstated — and that is the right trade for a *priority*: overstating a part
 * loads it early, which costs bandwidth, while understating it leaves a visible
 * part as a box, which the user sees.
 *
 * A part containing the camera returns `Infinity` rather than dividing by zero:
 * you are inside it, so it is as important as anything can be.
 */
export function screenHeightPx(camera: Camera, box: BoundingBox): number {
  const d = distanceTo(camera, box);
  const r = radius(box);
  if (d <= r) return Number.POSITIVE_INFINITY;
  const angle = 2 * Math.atan(r / d);
  return (angle / camera.fovY) * camera.viewportHeightPx;
}

/**
 * Is any of this box in front of the camera?
 *
 * Deliberately a half-space test against the view direction rather than a full
 * six-plane frustum. The cheap test is the one that matters — a part *behind*
 * the viewer is half the assembly on an interior view — and the side planes are
 * already handled by screen size falling off towards the edges. A full frustum
 * cull would be more correct and would need the projection matrix, which is the
 * renderer's, and this module stays out of the renderer.
 */
export function isAhead(camera: Camera, box: BoundingBox): boolean {
  const c = centre(box);
  const toPart = [
    c[0] - camera.position[0],
    c[1] - camera.position[1],
    c[2] - camera.position[2],
  ];
  const along =
    toPart[0] * camera.direction[0] +
    toPart[1] * camera.direction[1] +
    toPart[2] * camera.direction[2];
  // Compared against -radius, not 0: a part straddling the camera plane is
  // partly visible, and culling it pops a hole in the foreground.
  return along >= -radius(box);
}

/**
 * Which detail level this part deserves from where the camera is.
 *
 * Distance is measured in the part's own radii, so the table is scale-free.
 */
export function lodFor(
  camera: Camera,
  box: BoundingBox,
  thresholds: LodThresholds = DEFAULT_LOD,
): DetailLevel {
  const r = radius(box);
  if (r <= 0) return 0;
  const radii = distanceTo(camera, box) / r;
  if (radii <= thresholds.fine) return 2;
  if (radii <= thresholds.medium) return 1;
  return 0;
}

/**
 * The priority of fetching this part: bigger is sooner.
 *
 * Screen size alone, with parts behind the camera pushed below everything in
 * front of it rather than dropped. Dropping them means a turn of the camera
 * finds nothing loaded; keeping them last means it finds them arriving.
 */
export function priority(camera: Camera, part: ScenePart): number {
  const pixels = screenHeightPx(camera, part.box);
  const visible = isAhead(camera, part.box);
  // Finite and ordered even for Infinity, so a sort is total.
  const size = Number.isFinite(pixels) ? pixels : Number.MAX_SAFE_INTEGER;
  return visible ? size : -1 / (1 + size);
}

export interface LoadRequest {
  id: string;
  level: DetailLevel;
}

export interface PlanOptions {
  thresholds?: LodThresholds;
  /** How many requests to issue this pass. */
  budget?: number;
  minPixels?: number;
}

/**
 * What to fetch next, in order, given where the camera is now.
 *
 * Returns only parts whose *wanted* level differs from what is loaded, so a
 * settled scene plans nothing and a camera move plans only the difference. Two
 * rules worth stating, because both are places a plausible implementation
 * silently thrashes:
 *
 * **A part already at a finer level than it now deserves is left alone.** Flying
 * away from a part must not re-fetch a coarser mesh: the fine one is already in
 * memory, drawing it costs a little more and fetching it again costs a round
 * trip for a visibly worse picture.
 *
 * **A part too small to see is not fetched at all**, however close the camera
 * is to the rest of the scene. On an assembly that is most of the parts, and it
 * is the difference between streaming a machine and streaming its fasteners.
 */
export function planLoads(
  camera: Camera,
  parts: readonly ScenePart[],
  options: PlanOptions = {},
): LoadRequest[] {
  const thresholds = options.thresholds ?? DEFAULT_LOD;
  const minPixels = options.minPixels ?? MIN_PIXELS_FOR_A_MESH;
  const budget = options.budget ?? parts.length;

  const wanted: Array<{ request: LoadRequest; score: number }> = [];
  for (const part of parts) {
    const pixels = screenHeightPx(camera, part.box);
    if (!isAhead(camera, part.box)) continue;
    if (pixels < minPixels) continue;
    const level = lodFor(camera, part.box, thresholds);
    const loaded = part.loaded ?? null;
    if (loaded !== null && loaded >= level) continue;
    wanted.push({ request: { id: part.id, level }, score: priority(camera, part) });
  }

  wanted.sort((a, b) => b.score - a.score || a.request.id.localeCompare(b.request.id));
  return wanted.slice(0, Math.max(0, budget)).map((entry) => entry.request);
}
