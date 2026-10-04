import { describe, expect, it } from "vitest";

import {
  ABSENT,
  FIELDS,
  FIXED_RANGES,
  colourField,
  colourFor,
  legendFor,
  magnitudeField,
  normalise,
  probeNode,
  ramp,
  rangeFor,
  type FieldKind,
} from "./scalar-field";

/**
 * P6 task 5, tested as the three honesty rules it is built on.
 *
 * This module and these tests were claimed by the master plan on 2026-09-16 and had never
 * been committed — one of ten such paths found by the audit of 2026-09-17. Each test below
 * names the wrong picture the rule prevents, because every failure here produces an image
 * that looks entirely plausible.
 */

const ALL_KINDS: FieldKind[] = [
  "stress",
  "displacement",
  "thickness",
  "damage",
  "temperature",
];

describe("an unmeasured node is not a low reading", () => {
  it("colours NaN grey rather than the bottom of the scale", () => {
    // The bottom of the scale is a reading; "nobody computed this" is not one. Painting
    // the second as the first turns a hole in a result set into a region of low stress.
    expect(colourFor(Number.NaN, { min: 0, max: 100, auto: true }, "stress")).toEqual(ABSENT);
  });

  it("leaves NaN out of the fitted range", () => {
    const withHole = rangeFor("stress", [10, Number.NaN, 30]);
    const without = rangeFor("stress", [10, 30]);

    expect(withHole).toEqual(without);
  });

  it("normalises an unmeasured value to null, not zero", () => {
    // `null` forces the caller to decide to paint ABSENT; returning 0 lets it forget.
    expect(normalise(Number.NaN, { min: 0, max: 1, auto: false }, "stress")).toBeNull();
  });

  it("probes an unmeasured node as not measured rather than as zero", () => {
    const probe = probeNode([1, Number.NaN, 3], "stress", 1);

    expect(probe.measured).toBe(false);
    expect(probe.value).toBeNull();
    expect(probe.text).toContain("not computed");
  });

  it("refuses a node index that is not in the field", () => {
    // Clamping would answer about the nearest node it has — a question nobody asked, at
    // the point the user pointed at.
    for (const node of [-1, 3, 1.5]) {
      const probe = probeNode([1, 2, 3], "stress", node);
      expect(probe.measured).toBe(false);
      expect(probe.text).toContain("no node");
    }
  });

  it("counts the grey nodes in the legend", () => {
    const legend = legendFor("stress", [1, Number.NaN, Number.NaN, 4]);

    expect(legend.absentNote).toContain("2 nodes");
    expect(legend.absentNote).toContain("not zero");
  });

  it("says nothing about grey when everything was measured", () => {
    expect(legendFor("stress", [1, 2, 3]).absentNote).toBeNull();
  });
});

describe("a fitted range says it was fitted", () => {
  it("marks an auto range and prints the caveat", () => {
    // Two screenshots of the same part with different auto ranges look like two
    // different results. The easiest way to mislead with a correct picture.
    const legend = legendFor("stress", [0, 50, 100]);

    expect(legend.caveat).toContain("not comparable");
  });

  it("prints no caveat for a range that was chosen", () => {
    expect(legendFor("damage", [0.1, 0.2]).caveat).toBeNull();
  });

  it("states its own bounds", () => {
    const legend = legendFor("stress", [10, 90]);

    expect(legend.min).toBe(10);
    expect(legend.max).toBe(90);
    expect(legend.ticks[0]).toBe(10);
    expect(legend.ticks[legend.ticks.length - 1]).toBe(90);
  });

  it("gives a constant field a band rather than a zero span", () => {
    // Widening by a hair would paint noise across the whole palette; a band keeps it one
    // colour, which is the truth about a constant field.
    const range = rangeFor("stress", [7, 7, 7]);

    expect(range.max).toBeGreaterThan(range.min);
    expect(colourFor(7, range, "stress")).toEqual(ramp(0));
  });

  it("gives a field with nothing measured a stated range rather than 0-0", () => {
    const range = rangeFor("stress", [Number.NaN, Number.NaN]);

    expect(range.auto).toBe(true);
    expect(range.max).toBeGreaterThan(range.min);
  });
});

describe("damage is never fitted", () => {
  it("pins to 0-1 whatever the data says", () => {
    // Fitting 0-0.02 across the palette paints a part that will last fifty lifetimes in
    // the same red as one about to crack.
    expect(rangeFor("damage", [0, 0.005, 0.02])).toEqual({ min: 0, max: 1, auto: false });
  });

  it("paints a safe part at the cool end", () => {
    const range = rangeFor("damage", [0.001, 0.02]);
    const [r, , b] = colourFor(0.02, range, "damage");

    expect(b).toBeGreaterThan(r);
  });

  it("paints a part at its life at the hot end", () => {
    const range = rangeFor("damage", [0.001, 1.0]);
    const [r, , b] = colourFor(1.0, range, "damage");

    expect(r).toBeGreaterThan(b);
  });

  it("is the only fixed range", () => {
    expect(Object.keys(FIXED_RANGES)).toEqual(["damage"]);
  });
});

describe("thickness runs the other way, and it is a property of the kind", () => {
  it("paints thin hot and thick cool", () => {
    // The assumption a caller who has read "high is red" everywhere else would get
    // wrong, so it is not a flag at the call site.
    const range = rangeFor("thickness", [1, 10]);
    const thin = colourFor(1, range, "thickness");
    const thick = colourFor(10, range, "thickness");

    expect(thin[0]).toBeGreaterThan(thin[2]);
    expect(thick[2]).toBeGreaterThan(thick[0]);
  });

  it("is the only kind that reverses", () => {
    const reversed = ALL_KINDS.filter((kind) => FIELDS[kind].lowIsBad);
    expect(reversed).toEqual(["thickness"]);
  });
});

describe("five kinds, one renderer", () => {
  it.each(ALL_KINDS)("%s has a label and a definition", (kind) => {
    expect(FIELDS[kind].label.length).toBeGreaterThan(3);
    expect(FIELDS[kind].kind).toBe(kind);
  });

  it("differs only by name, unit and palette direction", () => {
    // Never by a second renderer: every kind goes through the same `colourFor`.
    const field = [0, 5, 10];
    for (const kind of ALL_KINDS) {
      expect(colourField(field, kind)).toHaveLength(field.length * 3);
    }
  });

  it("gives every kind but damage a unit", () => {
    for (const kind of ALL_KINDS) {
      if (kind === "damage") expect(FIELDS[kind].unit).toBe("");
      else expect(FIELDS[kind].unit.length).toBeGreaterThan(0);
    }
  });

  it("reports a probe with its unit", () => {
    expect(probeNode([12.5], "stress", 0).text).toContain("MPa");
    expect(probeNode([0.5], "damage", 0).text).not.toContain("undefined");
  });
});

describe("the bridge from a solve to a colour bar", () => {
  it("takes the magnitude of a displacement per node", () => {
    expect(magnitudeField([[3, 4, 0]])).toEqual([5]);
  });

  it("gives NaN for a node with a missing component, not a short displacement", () => {
    expect(magnitudeField([[1, 2, Number.NaN]])[0]).toBeNaN();
    expect(magnitudeField([[1, 2]])[0]).toBeNaN();
  });

  it("keeps the node order", () => {
    const magnitudes = magnitudeField([
      [1, 0, 0],
      [0, 2, 0],
      [0, 0, 3],
    ]);
    expect(magnitudes).toEqual([1, 2, 3]);
  });
});

describe("the ramp", () => {
  it("runs blue to red", () => {
    expect(ramp(0)).toEqual([0, 0, 1]);
    expect(ramp(1)).toEqual([1, 0, 0]);
  });

  it("clamps rather than producing a colour off the end", () => {
    expect(ramp(-5)).toEqual(ramp(0));
    expect(ramp(5)).toEqual(ramp(1));
  });

  it("stays inside the unit cube everywhere", () => {
    for (let i = 0; i <= 100; i++) {
      for (const channel of ramp(i / 100)) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });
});
