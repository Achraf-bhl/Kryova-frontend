/**
 * What to fetch next, and at which level of detail — master plan P6 task 2.
 *
 * **At machine scale the problem is ordering, not drawing.** A 2,000-part machine is not
 * slow because a GPU cannot draw it; it is slow because the client asks for two thousand
 * meshes in declaration order and the user waits for a bolt behind the frame while the
 * frame is still queued. So this module answers one question — given a camera and a set
 * of parts, which part next and at what level — as arithmetic over bounding boxes.
 *
 * **There is no WebGL, no `fetch` and no React in here**, deliberately and for the reason
 * `app/design/` is kept free of the kernel: the ordering is the part worth testing, and it
 * becomes untestable the moment it is tangled with a GL context. A caller drives it and
 * does the loading.
 *
 * Five decisions, each of which is a way to get this wrong:
 *
 * 1. **LOD thresholds are in *part radii*, not millimetres.** One table then serves an M6
 *    nut and a two-metre weldment. A millimetre threshold loads the weldment at its
 *    coarsest level from across the room and the nut at its finest from the same place,
 *    which is backwards: what decides the level a part deserves is how much of the screen
 *    it covers, and that is its radius over its distance.
 *
 * 2. **A part already finer than it now deserves is left alone.** Flying away from a
 *    machine must never spend a round trip fetching a *worse* mesh. The level a part holds
 *    is therefore a high-water mark, and `plan` only ever proposes an improvement.
 *
 * 3. **Under about eight pixels a part gets no mesh at all.** On an assembly that is most
 *    of the parts, and it is the single biggest saving available — a part too small to
 *    read is indistinguishable from its own bounding box.
 *
 * 4. **Culling is a half-space test, not a six-plane frustum.** The cheap half is the one
 *    that matters on an interior view, where most of the machine is behind the camera. A
 *    full frustum needs the projection matrix, which belongs to the renderer this module
 *    stays out of. The consequence is stated rather than hidden: parts outside the
 *    viewport but in front of the camera are still fetched, later than visible ones.
 *
 * 5. **The comparator is total**, including for a part containing the camera. That part's
 *    distance is zero and its screen coverage is unbounded; `Infinity - Infinity` is `NaN`,
 *    and a comparator returning `NaN` leaves the order to the engine's sort — a viewer that
 *    loads something different first on every frame. Every branch below returns a number.
 *
 * No runtime dependency is added. The doctrine is three.
 */

/** A part's bounding sphere and what the client currently holds for it. */
export interface ScenePart {
  /** Occurrence path, e.g. `machine/station_0/part_017.1`. Identity, not a label. */
  readonly path: string;
  /** Centre of the part's bounding sphere, in millimetres, in world coordinates. */
  readonly centreMm: readonly [number, number, number];
  /** Radius of that sphere, in millimetres. Zero is treated as "no extent". */
  readonly radiusMm: number;
  /**
   * The detail level already loaded, or `null` for nothing but a box.
   * Lower is finer: level 0 is the closest-up mesh `app/render/display.py` defines.
   */
  readonly level: number | null;
}

/** Where the viewer is looking from. No projection matrix: see decision 4. */
export interface Camera {
  readonly positionMm: readonly [number, number, number];
  /** Unit vector the camera looks along. Normalised by the caller. */
  readonly directionMm: readonly [number, number, number];
  /** Viewport height in device pixels, which is what turns a ratio into a size. */
  readonly viewportPx: number;
  /** Vertical field of view, radians. */
  readonly fovRad: number;
}

/** One thing for the caller to fetch. */
export interface FetchRequest {
  readonly path: string;
  readonly level: number;
  /** Apparent size in pixels, so a caller can log or throttle on it. */
  readonly screenPx: number;
}

/**
 * Apparent size, in pixels, below which a part is not worth a mesh.
 *
 * Eight rather than one because a part under eight pixels is a smudge either way, and the
 * saving is the whole point: on the reference assembly most parts are under it from any
 * view that shows the machine.
 */
export const MIN_SCREEN_PX = 8;

/**
 * Screen size, in pixels, at or above which each level is deserved. Finest first, so the
 * index into this table *is* the level `app/render/display.py` serves.
 *
 * Read as: 256 px or more of screen earns level 0; 64 earns level 1; anything still above
 * `MIN_SCREEN_PX` earns level 2.
 */
export const LEVEL_SCREEN_PX: readonly number[] = [256, 64, 0];

/** The coarsest level there is — what a part just above the cutoff gets. */
export const COARSEST_LEVEL = LEVEL_SCREEN_PX.length - 1;

function subtract(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(a: readonly [number, number, number]): number {
  return Math.sqrt(dot(a, a));
}

/**
 * How many pixels across the part appears, or `Infinity` when it contains the camera.
 *
 * `Infinity` rather than a clamped large number because it is the truthful answer and the
 * comparator below is written to handle it. A part the camera is inside is the one thing
 * that must be loaded first, and at the finest level there is.
 */
export function screenSizePx(part: ScenePart, camera: Camera): number {
  const offset = subtract(part.centreMm, camera.positionMm);
  const distance = length(offset);
  if (distance <= part.radiusMm) return Number.POSITIVE_INFINITY;
  // The sphere subtends 2*asin(r/d); the small-angle form is within a pixel over the whole
  // range that matters and avoids a trigonometric call per part per frame.
  const angular = (2 * part.radiusMm) / distance;
  return (angular / camera.fovRad) * camera.viewportPx;
}

/**
 * Whether the part is in front of the camera. Decision 4: a half-space, not a frustum.
 *
 * A part straddling the plane counts as in front — its centre may be behind the camera
 * while half of it is visible, and the failure this avoids (a part popping in as the
 * camera creeps forward) is worse than fetching a few parts early.
 */
export function isInFront(part: ScenePart, camera: Camera): boolean {
  const offset = subtract(part.centreMm, camera.positionMm);
  return dot(offset, camera.directionMm) + part.radiusMm >= 0;
}

/** The finest level a part of this apparent size deserves, or `null` for none at all. */
export function levelFor(screenPx: number): number | null {
  if (screenPx < MIN_SCREEN_PX) return null;
  for (let level = 0; level < LEVEL_SCREEN_PX.length; level++) {
    if (screenPx >= LEVEL_SCREEN_PX[level]) return level;
  }
  return COARSEST_LEVEL;
}

/**
 * Whether `part` should be fetched, and at which level — or `null` to leave it.
 *
 * Decision 2 lives here: a part already at a level finer than it now deserves is left
 * alone, so the answer is only ever an improvement on what the client holds.
 */
export function wantedFor(part: ScenePart, camera: Camera): FetchRequest | null {
  if (!isInFront(part, camera)) return null;
  const screenPx = screenSizePx(part, camera);
  const deserved = levelFor(screenPx);
  if (deserved === null) return null;
  if (part.level !== null && part.level <= deserved) return null;
  return { path: part.path, level: deserved, screenPx };
}

/**
 * Order two pending fetches: bigger on screen first, then by path.
 *
 * **Total, including for two parts each containing the camera.** Comparing sizes with
 * subtraction gives `Infinity - Infinity === NaN`, and `Array.prototype.sort` with a
 * comparator that returns `NaN` is unspecified — in practice it leaves the pair in
 * whatever order the engine's merge happened to produce, so a viewer would load a
 * different part first on every frame with nothing in the code to blame. Comparison
 * operators are used instead, and the path breaks every remaining tie so the order is
 * fully determined by the input.
 */
export function compareRequests(a: FetchRequest, b: FetchRequest): number {
  if (a.screenPx > b.screenPx) return -1;
  if (a.screenPx < b.screenPx) return 1;
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

/**
 * The whole scene's fetch queue, most useful first.
 *
 * `limit` bounds how many are returned, because a caller with eight connections does not
 * want two thousand requests — but the *order* is computed over everything, so the limit
 * takes the best N rather than the first N found.
 */
export function plan(
  parts: readonly ScenePart[],
  camera: Camera,
  limit = Number.POSITIVE_INFINITY,
): FetchRequest[] {
  const wanted: FetchRequest[] = [];
  for (const part of parts) {
    const request = wantedFor(part, camera);
    if (request !== null) wanted.push(request);
  }
  wanted.sort(compareRequests);
  return Number.isFinite(limit) ? wanted.slice(0, Math.max(0, limit)) : wanted;
}
