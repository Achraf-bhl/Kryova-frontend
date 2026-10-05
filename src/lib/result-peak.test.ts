import { describe, expect, it } from "vitest";

import type { SimulationRead, StaticResult } from "@/types/api";

import { headlineStress } from "./result-peak";

const RESULT: StaticResult = {
  max_displacement_mm: 0.1,
  max_von_mises_mpa: 41.03,
  factor_of_safety: 6.1,
  yields: false,
  mass_kg: 1,
  volume_mm3: 1,
  node_count: 1,
  element_count: 1,
  solve_seconds: 1,
  warnings: [],
};

function sim(over: Partial<SimulationRead>): SimulationRead {
  return { result: RESULT, governing: null, ...over } as SimulationRead;
}

describe("the headline stress", () => {
  it("is absent when there is no result", () => {
    expect(headlineStress(sim({ result: null }))).toBeNull();
  });

  it("is the governing peak and its basis when the server sent one", () => {
    const h = headlineStress(
      sim({ governing: { peak_mpa: 59.78, basis: "nodal, at the surface", factor_of_safety: 4.2 } }),
    );
    expect(h?.governing).toBe(true);
    expect(h?.mpa).toBeCloseTo(59.78);
    expect(h?.basis).toBe("nodal, at the surface");
    expect(h?.factorOfSafety).toBeCloseTo(4.2);
  });

  it("keeps the element value beside a governing peak that differs from it", () => {
    const h = headlineStress(
      sim({ governing: { peak_mpa: 59.78, basis: "nodal, at the surface", factor_of_safety: 4.2 } }),
    );
    expect(h?.alsoElementMpa).toBeCloseTo(41.03);
  });

  it("does not repeat the element value when the two agree", () => {
    const h = headlineStress(
      sim({ governing: { peak_mpa: 41.03, basis: "element centroid", factor_of_safety: 6.1 } }),
    );
    expect(h?.alsoElementMpa).toBeNull();
  });

  it("falls back to the element value and labels it as that, never a bare max", () => {
    const h = headlineStress(sim({}));
    expect(h?.governing).toBe(false);
    expect(h?.label).toMatch(/element value/);
    expect(h?.basis).toMatch(/no governing peak/);
    expect(h?.mpa).toBeCloseTo(41.03);
  });
});
