/**
 * One selection across the tree, the 3D view and the spec panel (P6.6).
 *
 * The claims worth holding are about the states this model refuses to collapse:
 * "the name has not arrived" is not "there is no name", "this pick is not about a
 * feature" is not "the spec is missing the feature", and a positional name is not a
 * durable one. Each of those, collapsed, produces a UI that is confidently wrong.
 *
 * Written on Linux and not run (the user's rule; Windows runs vitest).
 */

import { describe, expect, it } from "vitest";

import {
  NOTHING_SELECTED,
  type NamingResponse,
  type Selection,
  ancestorsOf,
  componentOf,
  pickIn3D,
  pickInSpec,
  pickInTree,
  readNaming,
  revealFor,
  safeToAuthor,
  sameSelection,
} from "./selection-model";
import type { SceneNode } from "./viewer-interactions";

const box = { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };

/** frame → leg → foot, plus a sibling panel. */
const NODES: SceneNode[] = [
  { id: "frame", parent: null, box },
  { id: "leg", parent: "frame", box },
  { id: "foot", parent: "leg", box },
  { id: "panel", parent: "frame", box },
];

describe("what is selected", () => {
  it("starts with nothing and says so", () => {
    expect(componentOf(NOTHING_SELECTED)).toBeNull();
    expect(revealFor({ selection: NOTHING_SELECTED, nodes: NODES }).treeRow).toBeNull();
  });

  it("gives the same component whichever surface the pick came from", () => {
    expect(componentOf(pickInTree("leg"))).toBe("leg");
    expect(componentOf(pickIn3D("leg", 3))).toBe("leg");
    expect(componentOf(pickInSpec("leg", "boss"))).toBe("leg");
  });

  it("treats re-clicking the same thing as the same selection", () => {
    expect(sameSelection(pickIn3D("leg", 3), pickIn3D("leg", 3))).toBe(true);
    expect(sameSelection(pickIn3D("leg", 3), pickIn3D("leg", 4))).toBe(false);
    expect(sameSelection(pickIn3D("leg", 3), pickInTree("leg"))).toBe(false);
  });

  it("a face pick with no face falls back to the component rather than inventing face 0", () => {
    // `scene-streaming` draws anything under ~8 px as a box, so the renderer knows
    // which part was hit and not which face. Face 0 would name a face nobody clicked.
    expect(pickIn3D("leg", null)).toEqual({ kind: "component", componentId: "leg" });
    expect(pickIn3D("leg", -1).kind).toBe("component");
    expect(pickIn3D("leg", 1.5).kind).toBe("component");
  });
});

describe("the tree reveals the selection", () => {
  it("expands every ancestor so the row is on screen, root last", () => {
    expect(ancestorsOf(NODES, "foot")).toEqual(["leg", "frame"]);
    expect(ancestorsOf(NODES, "frame")).toEqual([]);
  });

  it("says nothing about a node that is not in the tree", () => {
    expect(ancestorsOf(NODES, "nowhere")).toEqual([]);
  });

  it("does not hang on a parent cycle", () => {
    const cyclic: SceneNode[] = [
      { id: "a", parent: "b", box },
      { id: "b", parent: "a", box },
    ];
    expect(ancestorsOf(cyclic, "a")).toEqual(["b"]);
  });
});

describe("the 3D view highlights the selection", () => {
  it("a component picked in the tree lights its whole subtree", () => {
    const reveal = revealFor({ selection: pickInTree("leg"), nodes: NODES });

    expect([...reveal.highlighted].sort()).toEqual(["foot", "leg"]);
    expect(reveal.expand).toEqual(["frame"]);
    expect(reveal.treeRow).toBe("leg");
  });

  it("a face lights only the part it is on, never the subtree", () => {
    // A face belongs to one solid. Lighting the children would claim the pick was
    // about the assembly.
    const reveal = revealFor({ selection: pickIn3D("leg", 2), nodes: NODES });

    expect([...reveal.highlighted]).toEqual(["leg"]);
    expect(reveal.face).toEqual({ componentId: "leg", faceIndex: 2 });
  });

  it("a selection naming a component the scene does not have highlights nothing", () => {
    // Not "everything": `subtree` on an unknown root returns that root alone, which
    // would draw a selection outline around nothing and read as a rendering bug.
    const reveal = revealFor({ selection: pickInTree("ghost"), nodes: NODES });

    expect(reveal.highlighted.size).toBe(0);
    expect(reveal.treeRow).toBeNull();
  });
});

describe("the spec panel scrolls to the feature", () => {
  it("a feature picked in the spec scrolls to itself", () => {
    const reveal = revealFor({
      selection: pickInSpec("leg", "boss"),
      nodes: NODES,
      specFeatures: ["slab", "boss"],
    });

    expect(reveal.specRow).toBe("boss");
    expect(reveal.featureMissingFromSpec).toBe(false);
  });

  it("a face reaches the spec only once the server has said which feature it is", () => {
    const withoutName = revealFor({
      selection: pickIn3D("leg", 2),
      nodes: NODES,
      specFeatures: ["slab"],
    });
    expect(withoutName.specRow).toBeNull();

    const withName = revealFor({
      selection: pickIn3D("leg", 2),
      nodes: NODES,
      specFeatures: ["slab"],
      featureOfFace: "slab",
    });
    expect(withName.specRow).toBe("slab");
  });

  it("a feature the spec does not hold is reported, never scrolled past", () => {
    // Distinct from "this pick is not about a feature". Scrolling to the top instead,
    // which is what a missing-key lookup does, makes it look like the first feature.
    const reveal = revealFor({
      selection: pickInSpec("leg", "gone"),
      nodes: NODES,
      specFeatures: ["slab", "boss"],
    });

    expect(reveal.specRow).toBeNull();
    expect(reveal.featureMissingFromSpec).toBe(true);
  });

  it("an unloaded spec is not a missing feature", () => {
    const reveal = revealFor({ selection: pickInSpec("leg", "boss"), nodes: NODES });

    expect(reveal.specRow).toBeNull();
    expect(reveal.featureMissingFromSpec).toBe(false);
  });
});

describe("naming a picked face keeps its four states apart", () => {
  const durable: NamingResponse = {
    face: 5,
    best: {
      argument: { type: "face", of: "slab", axis: "z", side: "max" },
      words: "faces at the max of z and belonging to slab",
      matches: 1,
      stable: true,
    },
    positional: null,
    offered: [],
    explanation: "This face is faces at the max of z and belonging to slab.",
  };

  const onlyPositional: NamingResponse = {
    face: 6,
    best: null,
    positional: {
      argument: { type: "face", inside: { min: [20.9, 19.9, 0], max: [21.1, 20.1, 20] } },
      words: "faces inside the given box",
      matches: 1,
      stable: false,
    },
    offered: [
      {
        argument: { type: "face", cylindrical: true, diameter_mm: 12 },
        words: "faces cylindrical and of diameter 12.0 mm",
        matches: 2,
        stable: true,
      },
    ],
    explanation:
      "Nothing describes this face by what it is — only by where it sits, which stops being true if the part is resized.",
  };

  it("reads a durable name as named", () => {
    const naming = readNaming(durable);

    expect(naming.state).toBe("named");
    expect(safeToAuthor(naming)).toBe(true);
  });

  it("reads a box-only answer as positional and refuses to author it silently", () => {
    // Two identical bores is the everyday case. A client that wrote the box into a
    // design without saying so would produce a design that breaks on the first resize.
    const naming = readNaming(onlyPositional);

    expect(naming.state).toBe("positional");
    expect(safeToAuthor(naming)).toBe(false);
    expect(naming.state === "positional" && naming.explanation).toContain(
      "where it sits",
    );
  });

  it("never reaches for offered[0], which may name three faces", () => {
    const naming = readNaming({ ...onlyPositional, positional: null });

    expect(naming.state).toBe("unnamed");
    expect(JSON.stringify(naming)).not.toContain("cylindrical");
  });

  it("keeps not-yet-asked and no-name-exists apart", () => {
    // Collapsed, the UI shows an empty field for both and the user cannot tell a slow
    // server from a face that has no description.
    expect(safeToAuthor({ state: "idle" })).toBe(false);
    expect(safeToAuthor({ state: "asking" })).toBe(false);
    expect(safeToAuthor({ state: "unnamed", explanation: "x" })).toBe(false);
  });
});

describe("the model holds no per-surface state", () => {
  it("derives every surface from the one selection on every call", () => {
    // The whole reason the module exists: there is no setter a surface could have
    // missed, so two surfaces cannot disagree.
    const selection: Selection = pickInTree("foot");
    const first = revealFor({ selection, nodes: NODES, specFeatures: ["slab"] });
    const second = revealFor({ selection, nodes: NODES, specFeatures: ["slab"] });

    expect([...first.highlighted]).toEqual([...second.highlighted]);
    expect(first.expand).toEqual(second.expand);
    expect(first.expand).toEqual(["leg", "frame"]);
  });
});
