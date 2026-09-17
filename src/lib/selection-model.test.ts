import { describe, expect, it } from "vitest";

import {
  NOTHING,
  apply,
  clear,
  describe as describeSelection,
  featureFor,
  isFaceSelected,
  isPartSelected,
  offerFor,
  partOf,
  reconcile,
  selectFace,
  selectPart,
} from "./selection-model";

/**
 * P6 task 6's frontend half.
 *
 * This module and its tests were claimed by the master plan on 2026-09-16 and had never
 * been committed — the last of ten such paths found by the audit of 2026-09-17. Each test
 * names the disagreement it prevents, because every failure here is two surfaces showing
 * different things rather than an error anybody sees.
 */

describe("a face selection is a part selection", () => {
  it("names the part for the tree to highlight", () => {
    // The tree cannot highlight a face. Asking it to would leave it showing nothing while
    // the viewer shows something — the disagreement this module exists to prevent.
    const selection = selectFace("m/plate", 3, "viewer").selection;

    expect(partOf(selection)).toBe("m/plate");
    expect(isPartSelected(selection, "m/plate")).toBe(true);
  });

  it("highlights only the picked face in the viewer", () => {
    const selection = selectFace("m/plate", 3, "viewer").selection;

    expect(isFaceSelected(selection, "m/plate", 3)).toBe(true);
    expect(isFaceSelected(selection, "m/plate", 4)).toBe(false);
    expect(isFaceSelected(selection, "m/other", 3)).toBe(false);
  });

  it("highlights no face for a part selection", () => {
    const selection = selectPart("m/plate", "tree").selection;

    expect(isPartSelected(selection, "m/plate")).toBe(true);
    expect(isFaceSelected(selection, "m/plate", 0)).toBe(false);
  });

  it("names nothing when nothing is selected", () => {
    expect(partOf(NOTHING)).toBeNull();
    expect(isPartSelected(NOTHING, "m/plate")).toBe(false);
  });
});

describe("clicking the same thing again is not a toggle", () => {
  it("keeps the part selected", () => {
    // A tree row clicked twice is still that row. Making the second click a toggle means
    // a double-click clears the panel, which reads as the app losing the selection.
    const first = selectPart("m/plate", "tree").selection;
    const second = apply(first, selectPart("m/plate", "tree"));

    expect(second).toEqual(first);
    expect(isPartSelected(second, "m/plate")).toBe(true);
  });

  it("narrows to a face when a face of the selected part is picked", () => {
    // The one case where a second click means something different, and it is a
    // refinement rather than a toggle.
    const part = selectPart("m/plate", "tree").selection;
    const narrowed = apply(part, selectFace("m/plate", 2, "viewer"));

    expect(narrowed.kind).toBe("face");
    expect(partOf(narrowed)).toBe("m/plate");
  });

  it("clears only when clearing is asked for", () => {
    const part = selectPart("m/plate", "tree").selection;
    expect(apply(part, clear("tree"))).toEqual(NOTHING);
  });

  it("carries which surface the event came from, so none re-scrolls itself", () => {
    expect(selectPart("m/plate", "spec").from).toBe("spec");
    expect(selectFace("m/plate", 1, "viewer").from).toBe("viewer");
  });
});

describe("a part with no feature says so rather than scrolling", () => {
  const owners = { "m/plate": "plate.body" };

  it("scrolls when the spec owns the part", () => {
    const link = featureFor(selectPart("m/plate", "tree").selection, owners);

    expect(link.action).toBe("scroll");
    expect(link.feature).toBe("plate.body");
  });

  it("explains when it does not", () => {
    // Scrolling to the top puts the first feature under the user's eye and looks exactly
    // like an answer — which is what makes a wrong feature worse than none.
    const link = featureFor(selectPart("m/bought-bearing", "tree").selection, owners);

    expect(link.action).toBe("explain");
    expect(link.feature).toBeNull();
    expect(link.note).toContain("not built by the design");
  });

  it("says nothing at all when nothing is selected", () => {
    const link = featureFor(NOTHING, owners);

    expect(link.feature).toBeNull();
    expect(link.note).toBeNull();
  });

  it("uses the part's feature for a face selection too", () => {
    const link = featureFor(selectFace("m/plate", 5, "viewer").selection, owners);
    expect(link.feature).toBe("plate.body");
  });
});

describe("what a picked face offers", () => {
  it("offers a durable name plainly", () => {
    const offer = offerFor({ best: '{"type":"face","axis":"z","side":"max"}', positional: null, alsoSelects: 1 });

    expect(offer.argument).toContain("face");
    expect(offer.caveat).toBeNull();
  });

  it("offers a positional name only with its caveat", () => {
    // A positional box always resolves uniquely, so offering it silently would mean the
    // ambiguous case never surfaced at all.
    const offer = offerFor({ best: null, positional: '{"type":"box"}', alsoSelects: 1 });

    expect(offer.argument).toContain("box");
    expect(offer.caveat).toContain("will not survive");
  });

  it("offers nothing, and says how many the closest match selects", () => {
    // "Selects 2 faces including this one" is a fact the user can act on; a name that
    // means both is not.
    const offer = offerFor({ best: null, positional: null, alsoSelects: 2 });

    expect(offer.argument).toBeNull();
    expect(offer.caveat).toContain("2 faces");
  });

  it("says nothing describes it when there is no near match either", () => {
    const offer = offerFor({ best: null, positional: null, alsoSelects: 1 });

    expect(offer.argument).toBeNull();
    expect(offer.caveat).toContain("on its own");
  });
});

describe("a selection that no longer exists is dropped", () => {
  const paths = ["m/plate", "m/cover"];

  it("clears a part that the rebuild removed, and says why", () => {
    // A stale path highlights nothing in any surface, which the user reads as the click
    // having failed rather than as the part having gone.
    const result = reconcile(selectPart("m/gone", "tree").selection, paths);

    expect(result.selection).toEqual(NOTHING);
    expect(result.reason).toContain("no longer in this design");
  });

  it("keeps a part that survived", () => {
    const selection = selectPart("m/plate", "tree").selection;
    const result = reconcile(selection, paths);

    expect(result.selection).toEqual(selection);
    expect(result.reason).toBeNull();
  });

  it("narrows a face that the rebuild renumbered away, keeping the part", () => {
    // A rebuild that added a fillet renumbers faces: face 7 of the new part is not face 7
    // of the old one. The part is the half of the selection that survived.
    const result = reconcile(selectFace("m/plate", 7, "viewer").selection, paths, () => 6);

    expect(result.selection).toEqual({ kind: "part", path: "m/plate" });
    expect(result.reason).toContain("still selected");
  });

  it("keeps a face that is still in range", () => {
    const selection = selectFace("m/plate", 2, "viewer").selection;
    const result = reconcile(selection, paths, () => 6);

    expect(result.selection).toEqual(selection);
    expect(result.reason).toBeNull();
  });

  it("leaves an empty selection alone", () => {
    expect(reconcile(NOTHING, paths).reason).toBeNull();
  });

  it("does not need a face count to reconcile a part", () => {
    expect(reconcile(selectPart("m/plate", "tree").selection, paths).selection.kind).toBe("part");
  });
});

describe("describing the selection", () => {
  it("uses the name the engineer gave, not the path", () => {
    // The same reason the proposer offers the engineer's feature name and not `Pad.1`.
    expect(describeSelection(selectPart("m/p1", "tree").selection, { "m/p1": "Top plate" })).toBe(
      "Top plate",
    );
  });

  it("falls back to the path when there is no label", () => {
    expect(describeSelection(selectPart("m/p1", "tree").selection)).toBe("m/p1");
  });

  it("names the face as well", () => {
    expect(
      describeSelection(selectFace("m/p1", 4, "viewer").selection, { "m/p1": "Top plate" }),
    ).toBe("Top plate, face 4");
  });

  it("says so when nothing is selected", () => {
    expect(describeSelection(NOTHING)).toBe("Nothing selected");
  });
});
