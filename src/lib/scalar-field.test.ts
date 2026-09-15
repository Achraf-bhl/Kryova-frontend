import { describe, expect, it } from "vitest";

import {
  ABSENT,
  FIXED_RANGES,
  type ScalarField,
  autoRange,
  colourAt,
  colourBuffer,
  hasAnyValue,
  legendFor,
  magnitudeField,
  normalise,
  paletteFor,
  probeNode,
  sample,
} from "./scalar-field";

/**
 * Any scalar field on geometry, with one colour scale (master plan P6.5).
 *
 * Everything here is a way of getting a *plausible picture that is wrong*, which
 * is the failure mode a colour bar has: an unmeasured region painted as the
 * bottom of the scale, a damage field fitted so that 2% of life used is drawn
 * in the same red as failure, a fitted range presented as though somebody chose
 * it, and a probe that answers zero for a node nobody computed.
 *
 * Written on Linux and **not run** (the user's rule; Windows runs them).
 */

function field(values: number[], overrides: Partial<ScalarField> = {}): ScalarField {
  return {
    kind: "stress",
    label: "von Mises stress",
    unit: "MPa",
    values: new Float32Array(values),
    ...overrides,
  };
}

describe("an absent value is not a zero", () => {
  it("gives the absent colour, not the bottom of the scale", () => {
    const range = { min: 0, max: 100, auto: false };

    expect(colourAt(Number.NaN, range, "stress")).toEqual(ABSENT);
    expect(colourAt(0, range, "stress")).not.toEqual(ABSENT);
  });

  it("is left out of the fitted range", () => {
    /* One NaN dragging the minimum would repaint the whole part. */
    expect(autoRange(field([10, Number.NaN, 30]))).toEqual({ min: 10, max: 30, auto: true });
  });

  it("is reported by the probe as unmeasured rather than as 0", () => {
    const probe = probeNode(field([Number.NaN]), 0);

    expect(probe.measured).toBe(false);
    expect(probe.value).toBeNaN();
  });

  it("is distinguishable from a field where everything is absent", () => {
    expect(hasAnyValue(field([Number.NaN, Number.NaN]))).toBe(false);
    expect(hasAnyValue(field([Number.NaN, 1]))).toBe(true);
  });

  it("does not make a range over nothing look like 0 to 1", () => {
    expect(autoRange(field([Number.NaN]))).toEqual({ min: 0, max: 0, auto: true });
  });
});

describe("a fitted scale says it was fitted", () => {
  it("marks an auto range", () => {
    expect(autoRange(field([1, 2, 3])).auto).toBe(true);
  });

  it("puts the caveat on the legend", () => {
    /* Two screenshots of the same part mean different things under two fitted
       ranges, and the reader has no way to know without this. */
    const legend = legendFor(field([1, 2, 3]), autoRange(field([1, 2, 3])));

    expect(legend.note).toMatch(/fitted/i);
  });

  it("carries no note when the bounds were chosen", () => {
    expect(legendFor(field([1, 2]), { min: 0, max: 10, auto: false }).note).toBeNull();
  });
});

describe("damage is never fitted", () => {
  it("keeps the absolute 0 to 1 range", () => {
    /* Fitting 0-0.02 across the palette paints a part that will last fifty
       lifetimes in the same red as one about to crack. */
    const damage = field([0.001, 0.02], { kind: "damage", label: "damage", unit: "" });

    expect(autoRange(damage)).toEqual({ min: 0, max: 1, auto: false });
  });

  it("is declared as a fixed range rather than special-cased in the fitter", () => {
    expect(FIXED_RANGES.damage).toEqual({ min: 0, max: 1, auto: false });
  });

  it("draws 2% of life used near the bottom of the scale", () => {
    const damage = field([0.02], { kind: "damage", label: "damage", unit: "" });

    expect(normalise(0.02, autoRange(damage))).toBeCloseTo(0.02, 5);
  });
});

describe("the scale", () => {
  it("clamps outside its bounds rather than extrapolating", () => {
    const range = { min: 0, max: 10, auto: false };

    expect(normalise(-5, range)).toBe(0);
    expect(normalise(50, range)).toBe(1);
  });

  it("does not divide by zero on a uniform field", () => {
    expect(normalise(5, { min: 5, max: 5, auto: true })).toBe(0);
  });

  it("interpolates between palette stops", () => {
    const stops = [
      [0, 0, 0],
      [1, 1, 1],
    ] as const;

    expect(sample(stops, 0.5)).toEqual([0.5, 0.5, 0.5]);
  });

  it("returns the ends of the palette", () => {
    const stops = paletteFor("stress");
    const top = stops[stops.length - 1];

    expect(sample(stops, 0)).toEqual(stops[0]);
    /* The top end is `a + (b - a) * 1`, so it is the stop to within rounding
       rather than bit-identical to it. */
    sample(stops, 1).forEach((channel, index) => {
      expect(channel).toBeCloseTo(top[index], 9);
    });
  });

  it("runs hot at the thin end for thickness", () => {
    /* Thin is the problem, so the ramp is reversed on purpose: a caller that
       assumed "high is red" everywhere would draw the safe end as the risk. */
    const thin = colourAt(0, { min: 0, max: 10, auto: false }, "thickness");
    const thick = colourAt(10, { min: 0, max: 10, auto: false }, "thickness");

    expect(thin[0]).toBeGreaterThan(thick[0]);
  });
});

describe("the colour buffer", () => {
  it("writes three floats per node", () => {
    const buffer = colourBuffer(field([1, 2, 3]), { min: 1, max: 3, auto: false });

    expect(buffer).toHaveLength(9);
  });

  it("writes the absent colour in place, so the caller never branches", () => {
    const buffer = colourBuffer(field([1, Number.NaN]), { min: 0, max: 2, auto: false });

    /* Compared loosely because the buffer is Float32Array: 0.55 stored as a
       32-bit float reads back as 0.5500000119…, and an exact match here would
       be a test about IEEE 754 rather than about the absent colour. */
    [buffer[3], buffer[4], buffer[5]].forEach((channel, index) => {
      expect(channel).toBeCloseTo(ABSENT[index], 6);
    });
  });
});

describe("the probe", () => {
  it("reads one node's value with its own unit", () => {
    const probe = probeNode(field([7.5]), 0);

    expect(probe.value).toBeCloseTo(7.5, 5);
    expect(probe.unit).toBe("MPa");
    expect(probe.measured).toBe(true);
  });

  it("refuses a node that is not in the field", () => {
    /* A probe that silently answered about the wrong node is worse than one
       that fails: the number it returns looks exactly like an answer. */
    expect(() => probeNode(field([1, 2]), 5)).toThrow(RangeError);
    expect(() => probeNode(field([1, 2]), -1)).toThrow(RangeError);
  });
});

describe("a vector field becomes a scalar one", () => {
  it("takes the magnitude per node", () => {
    const displacement = magnitudeField(
      new Float32Array([3, 4, 0, 0, 0, 2]),
      "displacement",
      "displacement",
      "mm",
    );

    expect(Array.from(displacement.values)).toEqual([5, 2]);
  });

  it("keeps the unit it was given, because nothing here converts", () => {
    const displacement = magnitudeField(new Float32Array([1, 0, 0]), "displacement", "d", "mm");

    expect(displacement.unit).toBe("mm");
  });
});

describe("the legend", () => {
  it("spans the range with evenly spaced ticks", () => {
    const legend = legendFor(field([0, 100]), { min: 0, max: 100, auto: false }, 5);

    expect(legend.ticks.map((tick) => tick.value)).toEqual([0, 25, 50, 75, 100]);
    expect(legend.ticks[0].at).toBe(0);
    expect(legend.ticks[4].at).toBe(1);
  });

  it("carries the unit, so a bar of bare numbers cannot be misread", () => {
    expect(legendFor(field([0, 1]), { min: 0, max: 1, auto: false }).unit).toBe("MPa");
  });
});
