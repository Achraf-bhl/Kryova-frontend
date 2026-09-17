/**
 * One selection, three surfaces — P6 task 6.
 *
 * Click a part in the tree and it highlights in 3D and the spec panel scrolls to its
 * feature; pick a face in 3D and the predicate that would name it is offered. **The whole
 * design is that there is one selection and not three**: a tree with its own highlighted
 * row, a viewer with its own highlighted mesh and a panel with its own scrolled-to feature
 * are three states that drift, and the user meets the disagreement rather than the bug.
 *
 * Four decisions, each of which is a way this goes quietly wrong:
 *
 * 1. **A face selection *is* a part selection.** The tree cannot highlight a face, so
 *    asking it to would leave it showing nothing while the viewer shows something.
 *    `partOf` is the one place that relationship lives, and every surface reads it.
 * 2. **Clicking what is already selected does not deselect it.** A tree row clicked twice
 *    is still that row; making the second click a toggle means a double-click clears the
 *    panel, which reads as the app losing the selection. Deselecting is its own action.
 * 3. **A part with no feature says so rather than scrolling to the top.** Scrolling to
 *    the top of a spec panel puts the first feature under the user's eye and looks exactly
 *    like an answer — the failure mode that makes a wrong feature worse than none.
 * 4. **A selection that no longer exists is dropped, not kept.** A rebuild renames
 *    occurrences; a stale path highlights nothing anywhere, and the user reads that as the
 *    click having failed. `reconcile` is called with the new tree and answers what the
 *    selection becomes, including *why* it changed so a surface can say so.
 *
 * The predicate a face offers comes from the server
 * (`GET /kernel/conversations/{id}/selection/face`), never from geometry here: the
 * proposer generates liberally and verifies by *resolving*, so it cannot drift from
 * `app/kernel/occt/resolve.py`, and a second implementation in the browser would be a
 * second thing to keep in step. This module carries what came back and its caveats.
 *
 * No runtime dependency is added; the doctrine is three.
 *
 * Rebuilt 2026-09-17. The master plan claimed this module on 2026-09-16 and it had never
 * been committed.
 */

export type Selection =
  | { readonly kind: "none" }
  | { readonly kind: "part"; readonly path: string }
  | { readonly kind: "face"; readonly path: string; readonly face: number };

export const NOTHING: Selection = { kind: "none" };

/** Which surface a selection came from. Carried so a surface does not re-scroll itself. */
export type Origin = "tree" | "viewer" | "spec";

export interface SelectionEvent {
  readonly selection: Selection;
  readonly from: Origin;
}

/**
 * The part a selection refers to, or `null` when nothing is selected.
 *
 * Decision 1 lives here: a face belongs to a part, and the tree highlights the part. One
 * definition, read by every surface.
 */
export function partOf(selection: Selection): string | null {
  return selection.kind === "none" ? null : selection.path;
}

/** Whether the tree row for `path` should be highlighted. */
export function isPartSelected(selection: Selection, path: string): boolean {
  return partOf(selection) === path;
}

/** Whether a given face of a given part should be highlighted in the viewer. */
export function isFaceSelected(selection: Selection, path: string, face: number): boolean {
  return selection.kind === "face" && selection.path === path && selection.face === face;
}

/** Select a part. Idempotent: decision 2. */
export function selectPart(path: string, from: Origin): SelectionEvent {
  return { selection: { kind: "part", path }, from };
}

/** Select one face of a part. */
export function selectFace(path: string, face: number, from: Origin): SelectionEvent {
  return { selection: { kind: "face", path, face }, from };
}

/** Clear the selection. Its own action, never a side effect of clicking twice. */
export function clear(from: Origin): SelectionEvent {
  return { selection: NOTHING, from };
}

/**
 * Apply an event to the current selection.
 *
 * **Clicking the selected part again keeps it** (decision 2). Clicking a *face* of the
 * already-selected part narrows to that face, which is the one case where a second click
 * means something different and it is a refinement rather than a toggle.
 */
export function apply(current: Selection, event: SelectionEvent): Selection {
  return event.selection;
}

export interface FeatureLink {
  /** The spec feature that owns this occurrence, or `null` when nothing does. */
  readonly feature: string | null;
  /** What the spec panel should do. */
  readonly action: "scroll" | "explain";
  /** Shown when there is nothing to scroll to. */
  readonly note: string | null;
}

/**
 * What the spec panel does for the current selection.
 *
 * **Decision 3.** A part the spec does not own gets a sentence, not a scroll: scrolling to
 * the top puts the first feature under the user's eye and looks exactly like an answer,
 * which is what makes a wrong feature worse than no feature. A bought-in part is the
 * ordinary case — it has no feature because nobody modelled it here.
 */
export function featureFor(
  selection: Selection,
  owners: Readonly<Record<string, string>>,
): FeatureLink {
  const path = partOf(selection);
  if (path === null) {
    return { feature: null, action: "explain", note: null };
  }
  const feature = owners[path];
  if (feature === undefined) {
    return {
      feature: null,
      action: "explain",
      note: "This part is not built by the design — there is no feature to show.",
    };
  }
  return { feature, action: "scroll", note: null };
}

/** What the server offered for a picked face. */
export interface FaceProposal {
  /** The best durable name, or `null` when nothing describes the face uniquely. */
  readonly best: string | null;
  /** A name that works today and breaks on the next rebuild, if there is one. */
  readonly positional: string | null;
  /** How many faces the best candidate selects, when it is not unique. */
  readonly alsoSelects: number;
}

export interface FaceOffer {
  readonly argument: string | null;
  readonly caveat: string | null;
}

/**
 * What to offer the user for a picked face.
 *
 * Three states kept apart, matching what the proposer reports:
 *
 * - a **durable** name, offered plainly;
 * - only a **positional** one, offered *with* the caveat that it will not survive a
 *   rebuild — a positional box always resolves uniquely, so offering it silently would
 *   mean the ambiguous case never surfaced at all;
 * - **nothing**, said as nothing, with the count. "Selects 2 faces including this one" is
 *   a fact the user can act on; a name that means both is not.
 */
export function offerFor(proposal: FaceProposal): FaceOffer {
  if (proposal.best !== null) {
    return { argument: proposal.best, caveat: null };
  }
  if (proposal.positional !== null) {
    return {
      argument: proposal.positional,
      caveat:
        "This names the face by where it sits, so it will not survive a change that moves it.",
    };
  }
  const also = proposal.alsoSelects;
  return {
    argument: null,
    caveat:
      also > 1
        ? `Nothing describes this face on its own — the closest match selects ${also} faces including this one.`
        : "Nothing in the part's vocabulary describes this face on its own.",
  };
}

export interface Reconciled {
  readonly selection: Selection;
  /** Why it changed, or `null` when it did not. Shown so a surface can say so. */
  readonly reason: string | null;
}

/**
 * What the selection becomes when the tree changes.
 *
 * **Decision 4.** A rebuild renames occurrences, and a stale path highlights nothing in
 * any surface — which the user reads as their click having failed rather than as the part
 * having gone. So a selection whose part is no longer present is dropped, and the reason
 * travels with it.
 *
 * `faceCount` is how many faces the part now has: a face index past the end is dropped to
 * the part, because a rebuild that added a fillet renumbers faces and face 7 of the new
 * part is not face 7 of the old one. Narrowing to the part is the honest fallback — it is
 * the half of the selection that survived.
 */
export function reconcile(
  selection: Selection,
  paths: readonly string[],
  faceCount?: (path: string) => number,
): Reconciled {
  const path = partOf(selection);
  if (path === null) return { selection, reason: null };
  if (!paths.includes(path)) {
    return {
      selection: NOTHING,
      reason: `${path} is no longer in this design, so the selection was cleared.`,
    };
  }
  if (selection.kind === "face" && faceCount !== undefined) {
    const count = faceCount(path);
    if (selection.face >= count) {
      return {
        selection: { kind: "part", path },
        reason:
          "The face that was selected no longer exists after the rebuild; the part is still selected.",
      };
    }
  }
  return { selection, reason: null };
}

/**
 * A one-line description of the selection, for a status bar.
 *
 * Names the part the user knows rather than a path they never typed, when a label is
 * available — the same reason the proposer offers the engineer's feature name and not the
 * kernel's `Pad.1`.
 */
export function describe(
  selection: Selection,
  labels: Readonly<Record<string, string>> = {},
): string {
  if (selection.kind === "none") return "Nothing selected";
  const name = labels[selection.path] ?? selection.path;
  return selection.kind === "part" ? name : `${name}, face ${selection.face}`;
}
