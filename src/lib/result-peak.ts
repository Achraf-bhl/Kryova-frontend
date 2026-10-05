/**
 * The headline stress on a result page, and what it is the peak *of* (ROAD_TO_10 8.3).
 *
 * Two numbers describe "the peak" and each under-reads where the other does not: the element
 * value at the centroid sits inboard of the skin and misses a bending peak; the nodal value
 * averages across elements and flatters a sharp concentration. A verdict rests on the larger,
 * and the server names which it was. This module only chooses what to *show*: the governing
 * figure when the server sent one, otherwise the element value labelled as such -- never a
 * bare "Max von Mises" that could be either.
 */

import type { SimulationRead } from "@/types/api";

export interface Headline {
  label: string;
  mpa: number;
  /** The server's own words for the basis, or the fallback's. */
  basis: string;
  factorOfSafety: number;
  /** True when this is the governing figure rather than the older element-only value. */
  governing: boolean;
  /** The element value, when it differs from the headline, so neither number is hidden. */
  alsoElementMpa: number | null;
}

export function headlineStress(simulation: SimulationRead): Headline | null {
  const result = simulation.result;
  if (!result) return null;
  const governing = simulation.governing;
  if (governing) {
    return {
      label: "Governing peak von Mises",
      mpa: governing.peak_mpa,
      basis: governing.basis,
      factorOfSafety: governing.factor_of_safety,
      governing: true,
      alsoElementMpa:
        Math.abs(result.max_von_mises_mpa - governing.peak_mpa) < 0.05
          ? null
          : result.max_von_mises_mpa,
    };
  }
  return {
    label: "Max von Mises (element value)",
    mpa: result.max_von_mises_mpa,
    basis: "element centroid; no governing peak was reported for this run",
    factorOfSafety: result.factor_of_safety,
    governing: false,
    alsoElementMpa: null,
  };
}
