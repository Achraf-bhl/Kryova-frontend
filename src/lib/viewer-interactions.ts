/**
 * Section planes, exploded views, hide/isolate and bookmarks — P6 task 4.
 *
 * **The four are one module because they are one state**, and the bookmark is why. A
 * bookmark that stored only the camera restores a solid block where the user saw a bore,
 * or a machine with forty fasteners that were hidden when it was taken. So it carries the
 * sections, the hidden set and the explode factor too, and deep-copies in both directions
 * so that dragging a slider cannot rewrite a saved view.
 *
 * Measuring is deliberately **not** here: it is a backend query
 * (`GET /kernel/conversations/{id}/measure/between` and `.../measure/element`), because
 * the viewer's mesh detail comes from screen size, so a browser-side distance would be
 * wrong by the chord error *and would change when the camera moved*. Two measurers agree
 * today and disagree after a fix to one.
 *
 * Four traps, each pinned by a test, each producing a plausible wrong picture rather than
 * an error:
 *
 * 1. **A section plane's normal points at the material that is removed.** That is
 *    `catia_split`'s convention, and two conventions for one question is how a part ends
 *    up mirrored with every test green.
 * 2. **Sides are decided on the box's corners, not its centre.** A long member running
 *    through the cut reads as wholly on one side from its centre, and then vanishes from
 *    the section view it is supposed to appear in.
 * 3. **A component centred on the assembly's centre does not move when exploded.**
 *    Normalising a zero vector gives `NaN`, and a `NaN` translation removes the part from
 *    the view with nothing raising — on a symmetric machine that part is the main shaft.
 * 4. **Hide wins over isolate**, and an isolated root that is not in the tree shows
 *    *nothing* rather than falling back to the whole machine. A silent fallback to
 *    everything is the opposite of what "isolate" was asked for.
 *
 * No runtime dependency is added; the doctrine is three.
 *
 * Rebuilt 2026-09-17. The master plan claimed this module on 2026-09-16 and it had never
 * been committed; the traps above are what that status recorded.
 */

export type Vec3 = readonly [number, number, number];

/** An axis-aligned bounding box in millimetres. */
export interface Box {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** One occurrence in the viewer: its path and where it sits. */
export interface ViewerPart {
  readonly path: string;
  readonly box: Box;
}

/**
 * A cutting plane. **`normal` points at the material that is removed** — `catia_split`'s
 * convention, kept here so the viewer and the kernel cannot disagree about which half the
 * user asked to lose.
 */
export interface SectionPlane {
  readonly origin: Vec3;
  readonly normal: Vec3;
}

export interface ViewState {
  readonly sections: readonly SectionPlane[];
  /** Occurrence paths the user hid explicitly. */
  readonly hidden: readonly string[];
  /** Subtree to show alone, or `null` for the whole machine. */
  readonly isolated: string | null;
  /** 0 is assembled; 1 moves each part one radius out along its own direction. */
  readonly explode: number;
}

export function emptyView(): ViewState {
  return { sections: [], hidden: [], isolated: null, explode: 0 };
}

function centre(box: Box): Vec3 {
  return [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
}

/** Every one of a box's eight corners. Trap 2 depends on having all of them. */
export function corners(box: Box): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) {
        out.push([x, y, z]);
      }
    }
  }
  return out;
}

function signedDistance(point: Vec3, plane: SectionPlane): number {
  return (
    (point[0] - plane.origin[0]) * plane.normal[0] +
    (point[1] - plane.origin[1]) * plane.normal[1] +
    (point[2] - plane.origin[2]) * plane.normal[2]
  );
}

/**
 * Whether a section plane removes this part entirely.
 *
 * **Decided on the corners** (trap 2): a part is removed only when *every* corner is on
 * the removed side. A long member running through the cut has corners on both sides and
 * therefore survives — clipped by the renderer, which is where clipping belongs. Deciding
 * from the centre would delete it from the very view it is meant to appear in.
 */
export function isCutAway(part: ViewerPart, plane: SectionPlane): boolean {
  return corners(part.box).every((corner) => signedDistance(corner, plane) > 0);
}

/** Whether `path` is `root` or sits beneath it. */
export function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/**
 * The parts a viewer should draw, in the order given.
 *
 * **Hide wins over isolate** (trap 4): a part the user hid stays hidden even inside the
 * isolated subtree, because hiding is the more specific instruction and the user gave it
 * last. And an `isolated` root that matches nothing shows **nothing** — falling back to
 * the whole machine is the opposite of what "isolate" asked for, and it would look like
 * the control had failed to do anything.
 */
export function visibleParts(
  parts: readonly ViewerPart[],
  state: ViewState,
): ViewerPart[] {
  const hidden = new Set(state.hidden);
  return parts.filter((part) => {
    if (hidden.has(part.path)) return false;
    if (state.isolated !== null && !isUnder(part.path, state.isolated)) return false;
    return !state.sections.some((plane) => isCutAway(part, plane));
  });
}

/**
 * Where a part sits at the current explode factor.
 *
 * Each part moves outward along the direction from the assembly's centre to its own,
 * scaled by the factor and by its own size — so a big part moves further than a small one
 * and the machine opens rather than scattering.
 *
 * **Trap 3 is the guard at the top.** A component whose centre *is* the assembly's centre
 * has a zero direction; normalising it gives `NaN`, a `NaN` translation puts the part
 * nowhere, and nothing raises. On a symmetric machine that part is the main shaft — the
 * one the exploded view exists to show. It stays put instead, which is the honest answer:
 * there is no outward direction for a part at the centre.
 */
export function explodedOffset(
  part: ViewerPart,
  assembly: Box,
  explode: number,
): Vec3 {
  if (explode === 0) return [0, 0, 0];
  const origin = centre(assembly);
  const own = centre(part.box);
  const direction: Vec3 = [own[0] - origin[0], own[1] - origin[1], own[2] - origin[2]];
  const distance = Math.hypot(direction[0], direction[1], direction[2]);
  if (distance === 0) return [0, 0, 0];
  const radius = Math.hypot(
    part.box.max[0] - part.box.min[0],
    part.box.max[1] - part.box.min[1],
    part.box.max[2] - part.box.min[2],
  ) / 2;
  const scale = (explode * radius) / distance;
  return [direction[0] * scale, direction[1] * scale, direction[2] * scale];
}

/** A camera, as a bookmark stores it. */
export interface CameraPose {
  readonly positionMm: Vec3;
  readonly targetMm: Vec3;
  readonly upMm: Vec3;
}

/**
 * A saved view. **Everything the user could see, not just where they stood.**
 *
 * The name is the user's; `takenAt` is an ISO instant so two bookmarks of the same view a
 * week apart are distinguishable in a list.
 */
export interface Bookmark {
  readonly name: string;
  readonly takenAt: string;
  readonly camera: CameraPose;
  readonly view: ViewState;
}

function copyView(state: ViewState): ViewState {
  return {
    sections: state.sections.map((plane) => ({
      origin: [...plane.origin] as unknown as Vec3,
      normal: [...plane.normal] as unknown as Vec3,
    })),
    hidden: [...state.hidden],
    isolated: state.isolated,
    explode: state.explode,
  };
}

/**
 * Take a bookmark. **Deep copies**, so that dragging a slider afterwards cannot rewrite
 * a view somebody saved — the bug a shallow copy produces is a bookmark that silently
 * becomes whatever the user last did.
 */
export function bookmark(
  name: string,
  camera: CameraPose,
  view: ViewState,
  takenAt: string,
): Bookmark {
  return {
    name,
    takenAt,
    camera: {
      positionMm: [...camera.positionMm] as unknown as Vec3,
      targetMm: [...camera.targetMm] as unknown as Vec3,
      upMm: [...camera.upMm] as unknown as Vec3,
    },
    view: copyView(view),
  };
}

/** Restore a bookmark. Deep copies for the same reason, in the other direction. */
export function restore(saved: Bookmark): { camera: CameraPose; view: ViewState } {
  return {
    camera: {
      positionMm: [...saved.camera.positionMm] as unknown as Vec3,
      targetMm: [...saved.camera.targetMm] as unknown as Vec3,
      upMm: [...saved.camera.upMm] as unknown as Vec3,
    },
    view: copyView(saved.view),
  };
}

/**
 * What the view is doing, for a status line.
 *
 * Counts rather than adjectives, for `offline-capability.ts`'s reason: "3 parts hidden" is
 * checkable and "some parts hidden" is not, and a user who cannot see a part needs to
 * know whether the viewer is hiding it or it is genuinely absent.
 */
export function describeView(state: ViewState, total: number, visible: number): string[] {
  const notes: string[] = [];
  if (state.sections.length > 0) {
    notes.push(
      `${state.sections.length} section plane${state.sections.length === 1 ? "" : "s"}`,
    );
  }
  if (state.isolated !== null) notes.push(`isolated to ${state.isolated}`);
  if (state.hidden.length > 0) notes.push(`${state.hidden.length} hidden`);
  if (state.explode > 0) notes.push(`exploded ${Math.round(state.explode * 100)}%`);
  if (visible < total) notes.push(`showing ${visible} of ${total} parts`);
  return notes;
}
