/**
 * One selection, three surfaces: the tree, the 3D view and the spec panel (P6.6).
 *
 * The plan's sentence is "click a part in the tree, it highlights in 3D and the spec
 * panel scrolls to its feature; select a face in 3D and the predicate that would name it
 * is offered". The trap in that sentence is the word *one*.
 *
 * **Three surfaces each holding their own `selected` is how they drift.** The tree
 * highlights a component the viewer is no longer showing, the spec panel scrolls to a
 * feature nobody picked, and because each of the three is individually correct there is
 * nothing to see in any one of them. So there is exactly one `Selection` value here and
 * every surface *derives* what it should show from it — `revealFor` returns all three
 * answers at once, computed, never stored. A surface cannot be stale because a surface
 * holds nothing.
 *
 * **A face's name is not part of the selection**, and that is the other load-bearing
 * decision. Naming a face is a server question (`GET /kernel/conversations/{id}/
 * selection/face`), it is slow, and it has three outcomes rather than two: a durable
 * name, only a positional one, or nothing that describes the face at all — two identical
 * bores being the everyday case. Folding that into the selection would make "the name has
 * not arrived yet" and "there is no name" the same value, and the UI would show an empty
 * box for both. `FaceNaming` is a separate four-state thing, and `selection-model` never
 * invents a name.
 *
 * Pure: no fetch, no React, no GL, for `scene-streaming.ts`'s reason. The async call
 * belongs to the caller; this says what to do with each answer.
 *
 * No runtime dependency added — the doctrine is three.
 */

import type { SceneNode } from "./viewer-interactions";
import { subtree } from "./viewer-interactions";

/**
 * What is selected, by what was clicked.
 *
 * A discriminated union rather than a bag of optional ids, so "a face is selected"
 * cannot coexist with "a feature is selected" — which is the state three independent
 * surfaces produce within two clicks.
 */
export type Selection =
  | { readonly kind: "none" }
  | { readonly kind: "component"; readonly componentId: string }
  | {
      readonly kind: "face";
      readonly componentId: string;
      /**
       * The ordinal in the part's own face list — `topology.faces()` order, which is
       * what the display mesh's partition returns for a picked triangle. Only
       * meaningful against `componentId`'s shape, which is why it never travels alone.
       */
      readonly faceIndex: number;
    }
  | {
      readonly kind: "feature";
      readonly componentId: string;
      readonly featureName: string;
    };

export const NOTHING_SELECTED: Selection = { kind: "none" };

/** Which component a selection is about, whatever kind it is. */
export function componentOf(selection: Selection): string | null {
  return selection.kind === "none" ? null : selection.componentId;
}

/**
 * Whether two selections are the same pick.
 *
 * Used to make re-clicking the same thing a no-op rather than a second round trip to
 * the naming route, which is the expensive half of a face pick.
 */
export function sameSelection(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "none":
      return true;
    case "component":
      return a.componentId === (b as typeof a).componentId;
    case "face":
      return (
        a.componentId === (b as typeof a).componentId &&
        a.faceIndex === (b as typeof a).faceIndex
      );
    case "feature":
      return (
        a.componentId === (b as typeof a).componentId &&
        a.featureName === (b as typeof a).featureName
      );
  }
}

/**
 * How a face's name is coming along. Four states, and the last two are different.
 *
 * `named` carries a predicate that selects this face and nothing else and that survives
 * a resize. `positional` is a name that works today and stops being true when the part
 * changes size — the server marks it and so does this, because a client that writes one
 * into a design should have been told. `unnamed` is neither, and the honest UI for it is
 * to say the face cannot be described, not to show an empty field.
 */
export type FaceNaming =
  | { readonly state: "idle" }
  | { readonly state: "asking" }
  | {
      readonly state: "named";
      readonly argument: Readonly<Record<string, unknown>>;
      readonly words: string;
    }
  | {
      readonly state: "positional";
      readonly argument: Readonly<Record<string, unknown>>;
      readonly words: string;
      readonly explanation: string;
    }
  | { readonly state: "unnamed"; readonly explanation: string };

/** One entry of the naming route's `offered` list. */
export interface OfferedName {
  readonly argument: Readonly<Record<string, unknown>>;
  readonly words: string;
  readonly matches: number;
  readonly stable: boolean;
}

/** The naming route's payload, as the backend renders it. */
export interface NamingResponse {
  readonly face: number;
  readonly best: OfferedName | null;
  readonly positional: OfferedName | null;
  readonly offered: readonly OfferedName[];
  readonly explanation: string;
}

/**
 * Read the naming route's answer into the four states.
 *
 * **`best` first and `positional` only as a fallback**, mirroring the server, and never
 * `offered[0]` — the first offer may name three faces, and a client that reached for it
 * would fillet all three and report success.
 */
export function readNaming(response: NamingResponse): FaceNaming {
  if (response.best) {
    return {
      state: "named",
      argument: response.best.argument,
      words: response.best.words,
    };
  }
  if (response.positional) {
    return {
      state: "positional",
      argument: response.positional.argument,
      words: response.positional.words,
      explanation: response.explanation,
    };
  }
  return { state: "unnamed", explanation: response.explanation };
}

/**
 * Whether this naming may be written into a design without saying anything more.
 *
 * Only a durable name may. A positional one is offered to the user *with* its caveat or
 * not at all — which is a rule about the UI, so it is stated as a function rather than
 * left to each call site to remember.
 */
export function safeToAuthor(naming: FaceNaming): boolean {
  return naming.state === "named";
}

/** Every ancestor of `id`, root last. Empty when `id` is not in the tree. */
export function ancestorsOf(
  nodes: readonly SceneNode[],
  id: string,
): readonly string[] {
  const parents = new Map<string, string | null>();
  for (const node of nodes) parents.set(node.id, node.parent);
  if (!parents.has(id)) return [];

  const chain: string[] = [];
  const seen = new Set<string>([id]);
  let current = parents.get(id) ?? null;
  // Bounded by `seen` rather than by the node count: a malformed structure with a
  // parent cycle must not hang the viewer, the way `subtree` guards the same thing
  // from the other direction.
  while (current !== null && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = parents.get(current) ?? null;
  }
  return chain;
}

/** What each of the three surfaces should do about the current selection. */
export interface Reveal {
  /** Components the 3D view should draw as selected — a subtree, not one node. */
  readonly highlighted: ReadonlySet<string>;
  /** The face to outline, when the pick was a face. */
  readonly face: { readonly componentId: string; readonly faceIndex: number } | null;
  /** Tree rows to expand so the selected row is on screen, root last. */
  readonly expand: readonly string[];
  /** The tree row to mark and scroll to. */
  readonly treeRow: string | null;
  /** The spec row to scroll to, or `null` when the selection names no feature. */
  readonly specRow: string | null;
  /**
   * True when the selection names a feature the spec does not contain.
   *
   * Distinct from `specRow === null`, which is the ordinary "this pick is not about a
   * feature". This one means the pick *is* about a feature and the panel cannot show
   * it — a spec and a model that have come apart. Scrolling to the top instead, which
   * is what a missing-key lookup does by default, tells the user nothing and looks like
   * the feature is the first one.
   */
  readonly featureMissingFromSpec: boolean;
}

export interface RevealInput {
  readonly selection: Selection;
  readonly nodes: readonly SceneNode[];
  /**
   * Feature names the spec panel can scroll to, for the selected component. Omitted
   * means the spec is not loaded, which is *not* the same as a feature being absent
   * from it — so `featureMissingFromSpec` stays false.
   */
  readonly specFeatures?: readonly string[];
  /**
   * The feature a face belongs to, when the naming route said so. A face selection
   * cannot reach the spec panel without this, because a face ordinal is not a feature.
   */
  readonly featureOfFace?: string | null;
}

/**
 * The whole "what should each surface show" answer, derived from one selection.
 *
 * Deriving rather than storing is the point of the module — see the file docstring.
 * Every field is computed on each call, so there is no path by which one surface can
 * lag another.
 */
export function revealFor({
  selection,
  nodes,
  specFeatures,
  featureOfFace,
}: RevealInput): Reveal {
  const empty: Reveal = {
    highlighted: new Set(),
    face: null,
    expand: [],
    treeRow: null,
    specRow: null,
    featureMissingFromSpec: false,
  };
  if (selection.kind === "none") return empty;

  const known = nodes.some((node) => node.id === selection.componentId);
  // A selection naming a component this scene does not have highlights nothing rather
  // than highlighting everything. `subtree` on an unknown root returns a set holding
  // just that root, which would draw a selection outline around nothing and read as a
  // rendering bug; and the tree cannot scroll to a row it does not have.
  if (!known) return empty;

  const highlighted = subtree(nodes, selection.componentId);
  const expand = ancestorsOf(nodes, selection.componentId);

  // **A face pick highlights only the part it is on, never the subtree.** A face belongs
  // to one solid; lighting up the children of the component holding it would claim the
  // pick was about the assembly.
  const face =
    selection.kind === "face"
      ? { componentId: selection.componentId, faceIndex: selection.faceIndex }
      : null;

  const wantedFeature =
    selection.kind === "feature"
      ? selection.featureName
      : selection.kind === "face"
        ? (featureOfFace ?? null)
        : null;

  let specRow: string | null = null;
  let featureMissingFromSpec = false;
  if (wantedFeature !== null) {
    if (specFeatures === undefined) {
      // The spec is not loaded. Nothing to scroll to and nothing is wrong.
      specRow = null;
    } else if (specFeatures.includes(wantedFeature)) {
      specRow = wantedFeature;
    } else {
      featureMissingFromSpec = true;
    }
  }

  return {
    highlighted: face ? new Set([selection.componentId]) : highlighted,
    face,
    expand,
    treeRow: selection.componentId,
    specRow,
    featureMissingFromSpec,
  };
}

/**
 * The selection a click in the 3D view produces.
 *
 * `faceIndex` is `null` when the renderer could tell which component was hit but not
 * which face — a part still drawn as its bounding box, which `scene-streaming` does for
 * anything under about eight pixels. Selecting the component is the right answer there;
 * inventing face 0 would name a face nobody clicked.
 */
export function pickIn3D(
  componentId: string,
  faceIndex: number | null,
): Selection {
  if (faceIndex === null) return { kind: "component", componentId };
  if (!Number.isInteger(faceIndex) || faceIndex < 0) {
    return { kind: "component", componentId };
  }
  return { kind: "face", componentId, faceIndex };
}

/** The selection a click in the tree produces. */
export function pickInTree(componentId: string): Selection {
  return { kind: "component", componentId };
}

/** The selection a click in the spec panel produces. */
export function pickInSpec(componentId: string, featureName: string): Selection {
  return { kind: "feature", componentId, featureName };
}
