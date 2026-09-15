/**
 * What an engineer does to a view: cut it, explode it, hide things, come back to it (P6.4).
 *
 * Four interactions that are one module because they are one *state*: a section
 * plane, an explode factor, a set of hidden subtrees and a camera are all the
 * answer to "what am I looking at", and the bookmark at the bottom of this file
 * is the reason they cannot live in four places. A bookmark that stored only the
 * camera would restore the wrong picture the moment a section plane or a hidden
 * subtree had moved since — and it would do it silently, which is the failure
 * this module is shaped to avoid.
 *
 * Pure arithmetic and set logic over the scene tree, for `scene-streaming.ts`'s
 * reason: this is the part worth testing and it is untestable once tangled with
 * a GL context. Nothing here draws, fetches or measures.
 *
 * **Measuring is deliberately not here.** P6.4 asks for point-point, edge and
 * face-face measurement *against real geometry*, and the viewer's mesh is
 * decimated — `scene-streaming` picks its level from screen size, so a distance
 * computed here would be wrong by the chord error and would change when the
 * camera moved. The measurement is a backend query,
 * `GET /kernel/conversations/{id}/measure/between`, which drives the kernel's
 * own `catia_measure_between` over the B-rep. There is no client-side measurer
 * to be tempted by.
 *
 * No runtime dependency: the frontend has three by doctrine and this is vector
 * arithmetic on axis-aligned boxes.
 */

import { type BoundingBox, centre } from "./scene-streaming";

export type Vec3 = [number, number, number];

/**
 * A cutting plane.
 *
 * **The normal points at the material that is removed**, which is
 * `catia_split`'s convention and `app/render/section.py`'s. It is stated here
 * because two conventions for one question is how a part ends up mirrored with
 * every test green — the picture is plausible either way round and nothing
 * catches it.
 *
 * `offset` is the signed distance from the origin along the normal, so the
 * plane is `{ p : dot(p, normal) = offset }`.
 */
export interface SectionPlane {
  normal: Vec3;
  offset: number;
  enabled: boolean;
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function length(v: Vec3): number {
  return Math.sqrt(dot(v, v));
}

/**
 * How far a point is past the plane, positive on the side that is removed.
 *
 * Normalises the plane's normal rather than assuming it is unit-length, so the
 * number is a distance in millimetres whatever the caller passed. A plane with
 * a zero normal is not a plane; it returns `NaN` and `clips` reads that as
 * "cuts nothing" rather than as "cuts everything".
 */
export function signedDistance(plane: SectionPlane, point: Vec3): number {
  const scale = length(plane.normal);
  if (scale === 0) return Number.NaN;
  return (dot(plane.normal, point) - plane.offset) / scale;
}

/** Is this point in the material the plane removes? */
export function clipsPoint(plane: SectionPlane, point: Vec3): boolean {
  if (!plane.enabled) return false;
  const d = signedDistance(plane, point);
  return Number.isNaN(d) ? false : d > 0;
}

/** Where a whole box sits relative to a plane. */
export type Side = "kept" | "removed" | "crossing";

/**
 * Which side of the plane this box is on, testing the box's **corners**.
 *
 * Testing the centre alone would classify half the parts in an assembly wrongly
 * — a long member through the cut reads as entirely on one side — and the
 * consequence is not a wrong colour but a part that vanishes from a section
 * view while still being in the part. A crossing box is drawn and clipped by
 * the renderer; only a wholly removed one is dropped.
 */
export function sideOf(plane: SectionPlane, box: BoundingBox): Side {
  if (!plane.enabled) return "kept";
  let anyRemoved = false;
  let anyKept = false;
  for (let i = 0; i < 8; i++) {
    const corner: Vec3 = [
      i & 1 ? box.max[0] : box.min[0],
      i & 2 ? box.max[1] : box.min[1],
      i & 4 ? box.max[2] : box.min[2],
    ];
    const d = signedDistance(plane, corner);
    if (Number.isNaN(d)) return "kept";
    if (d > 0) anyRemoved = true;
    else anyKept = true;
    if (anyRemoved && anyKept) return "crossing";
  }
  return anyRemoved ? "removed" : "kept";
}

/**
 * A box that survives every enabled plane — `"removed"` only if some plane
 * removes all of it.
 *
 * Planes compose as an intersection of half-spaces, which is what a viewer with
 * three sliders means by three section planes.
 */
export function sideOfAll(planes: readonly SectionPlane[], box: BoundingBox): Side {
  let result: Side = "kept";
  for (const plane of planes) {
    const side = sideOf(plane, box);
    if (side === "removed") return "removed";
    if (side === "crossing") result = "crossing";
  }
  return result;
}

/** A plane through the middle of an axis of a box, cutting away the far half. */
export function midPlane(box: BoundingBox, axis: "x" | "y" | "z"): SectionPlane {
  const index = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  const normal: Vec3 = [0, 0, 0];
  normal[index] = 1;
  return { normal, offset: centre(box)[index], enabled: true };
}

/** One node of the product structure, as the viewer holds it. */
export interface SceneNode {
  id: string;
  /** The component this one sits in, or `null` at the root. */
  parent: string | null;
  box: BoundingBox;
}

/**
 * Where each component moves to at a given explode factor.
 *
 * Radially outward from the assembly's centre: the direction is the component's
 * own centre seen from the assembly's, and the distance is that separation times
 * the factor. Factor 0 is the assembled machine and is the identity, so the
 * animation has nothing special at its start.
 *
 * **A component centred exactly on the assembly's centre has no direction**, and
 * the honest answer is that it does not move. Normalising a zero vector gives
 * `NaN`, and a `NaN` translation puts the part at no position at all — it
 * disappears from the view with nothing raising, which reads as a part that was
 * never loaded. On a symmetric machine that is the *main shaft*.
 */
export function explodeOffsets(
  nodes: readonly SceneNode[],
  factor: number,
): Map<string, Vec3> {
  const offsets = new Map<string, Vec3>();
  if (nodes.length === 0) return offsets;

  const origin = assemblyCentre(nodes);
  for (const node of nodes) {
    const c = centre(node.box);
    const away: Vec3 = [c[0] - origin[0], c[1] - origin[1], c[2] - origin[2]];
    const separation = length(away);
    if (separation === 0) {
      offsets.set(node.id, [0, 0, 0]);
      continue;
    }
    offsets.set(node.id, [away[0] * factor, away[1] * factor, away[2] * factor]);
  }
  return offsets;
}

/** The centre of the box that contains every node. */
export function assemblyCentre(nodes: readonly SceneNode[]): Vec3 {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const node of nodes) {
    for (let axis = 0; axis < 3; axis++) {
      if (node.box.min[axis] < min[axis]) min[axis] = node.box.min[axis];
      if (node.box.max[axis] > max[axis]) max[axis] = node.box.max[axis];
    }
  }
  if (!Number.isFinite(min[0])) return [0, 0, 0];
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

/** Every node under `rootId`, including it. */
export function subtree(nodes: readonly SceneNode[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parent === null) continue;
    const siblings = children.get(node.parent);
    if (siblings) siblings.push(node.id);
    else children.set(node.parent, [node.id]);
  }

  const found = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const id = pending.pop() as string;
    // Guards a cycle as well as a diamond. A product structure should be a tree
    // and a malformed one must not hang the viewer.
    if (found.has(id)) continue;
    found.add(id);
    for (const child of children.get(id) ?? []) pending.push(child);
  }
  return found;
}

export interface VisibilityState {
  /** Subtrees the user has hidden. */
  hiddenRoots: readonly string[];
  /** Show only this subtree, or `null` for the whole machine. */
  isolatedRoot: string | null;
}

export const NOTHING_HIDDEN: VisibilityState = { hiddenRoots: [], isolatedRoot: null };

/**
 * Which nodes are visible.
 *
 * **Isolate narrows and hide subtracts, and hide wins where they disagree** —
 * isolating a gearbox and then hiding its housing must leave the gears showing,
 * which is the whole point of doing both. The opposite rule (isolate re-showing
 * what was hidden) is the one that feels like the viewer forgetting an
 * instruction.
 *
 * An isolated root that is not in the tree shows **nothing**, rather than
 * quietly falling back to the whole machine: the user asked to see one thing,
 * and showing them everything instead is indistinguishable from the isolate not
 * having worked.
 */
export function visible(
  nodes: readonly SceneNode[],
  state: VisibilityState = NOTHING_HIDDEN,
): Set<string> {
  const shown = new Set<string>();
  const kept =
    state.isolatedRoot === null ? null : subtree(nodes, state.isolatedRoot);

  const hidden = new Set<string>();
  for (const root of state.hiddenRoots) {
    for (const id of subtree(nodes, root)) hidden.add(id);
  }

  for (const node of nodes) {
    if (kept !== null && !kept.has(node.id)) continue;
    if (hidden.has(node.id)) continue;
    shown.add(node.id);
  }
  return shown;
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  up: Vec3;
}

/**
 * "The view we were talking about", saved against a conversation.
 *
 * It stores the **whole view state**, not just the camera, and that is the
 * decision worth defending. A bookmark taken through a section plane and
 * restored without one shows a solid block where the user saw a bore; a bookmark
 * taken with forty fasteners hidden and restored without that shows a different
 * machine. Both restore a camera correctly and show the wrong thing, and neither
 * announces it — so the state travels with the pose.
 *
 * `savedAt` is an ISO instant written by the caller, never read from a clock
 * here, for `app/assembly/locking.py`'s reason: a module with a clock in it
 * cannot be tested without sleeping.
 */
export interface ViewBookmark {
  id: string;
  name: string;
  conversationId: string;
  savedAt: string;
  camera: CameraPose;
  sections: SectionPlane[];
  visibility: VisibilityState;
  explodeFactor: number;
}

export interface ViewState {
  camera: CameraPose;
  sections: readonly SectionPlane[];
  visibility: VisibilityState;
  explodeFactor: number;
}

/**
 * Capture the current view as a bookmark.
 *
 * Copies every array and object it stores. A bookmark holding a reference to
 * the live section-plane array is not a bookmark — dragging the slider would
 * silently rewrite the saved view, and the user would find out by restoring it.
 */
export function bookmarkView(
  state: ViewState,
  { id, name, conversationId, savedAt }: Omit<ViewBookmark, keyof ViewState>,
): ViewBookmark {
  return {
    id,
    name,
    conversationId,
    savedAt,
    camera: {
      position: [...state.camera.position],
      target: [...state.camera.target],
      up: [...state.camera.up],
    },
    sections: state.sections.map((plane) => ({
      normal: [...plane.normal] as Vec3,
      offset: plane.offset,
      enabled: plane.enabled,
    })),
    visibility: {
      hiddenRoots: [...state.visibility.hiddenRoots],
      isolatedRoot: state.visibility.isolatedRoot,
    },
    explodeFactor: state.explodeFactor,
  };
}

/** The view a bookmark restores — copied out, for the reason above. */
export function restoreView(bookmark: ViewBookmark): ViewState {
  return bookmarkView(bookmark, {
    id: bookmark.id,
    name: bookmark.name,
    conversationId: bookmark.conversationId,
    savedAt: bookmark.savedAt,
  });
}

/**
 * The bookmarks belonging to one conversation, newest first.
 *
 * Scoped by conversation because that is what makes the name mean anything:
 * "the cracked corner" is the corner of the part *this* conversation is about.
 * Ties break on id so two renders of the same list agree.
 */
export function bookmarksFor(
  bookmarks: readonly ViewBookmark[],
  conversationId: string,
): ViewBookmark[] {
  return bookmarks
    .filter((one) => one.conversationId === conversationId)
    .sort(
      (a, b) => b.savedAt.localeCompare(a.savedAt) || a.id.localeCompare(b.id),
    );
}
