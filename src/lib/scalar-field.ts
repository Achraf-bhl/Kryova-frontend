/**
 * Any scalar field on a mesh, with one colour scale and a probe (P6.5).
 *
 * `surface-field.ts` carries von Mises stress from a solve, which was the only
 * field the viewer ever drew. This generalises the *drawing* half: stress,
 * displacement magnitude, wall thickness and fatigue damage are all one value
 * per node, and the difference between them is a name, a unit and how the scale
 * should be read — not a second renderer.
 *
 * It stays out of `surface-field.ts` rather than growing it, because that module
 * is about a wire format (a packed binary header, a JSON fallback) and this one
 * is about presentation. Two different reasons to change.
 *
 * **Three rules this codebase already holds, applied to a colour bar.**
 *
 * *A field that was not measured is not a field of zeros.* A node with no value
 * is `NaN` on the wire and stays `NaN` here; `colourAt` gives it the absent
 * colour rather than the bottom of the scale, because the bottom of the scale is
 * a reading and "nobody computed this" is not one.
 *
 * *The scale's bounds are stated, never inferred silently.* `autoRange` exists
 * and returns the range it chose *with* the fact that it chose it, so a legend
 * can say "0–184 MPa (auto)" rather than presenting a fitted range as though
 * somebody set it.
 *
 * *Units travel with the number.* A field carries its own unit string and the
 * legend renders it. A colour bar labelled 0–184 with no unit is the kind of
 * thing that gets read as millimetres.
 *
 * No runtime dependency: the palettes are arithmetic, and the frontend's three
 * dependencies are doctrine.
 */

/** What kind of quantity is being drawn. Decides the default palette. */
export type FieldKind = "stress" | "displacement" | "thickness" | "damage" | "temperature";

export interface ScalarField {
  kind: FieldKind;
  /** Shown on the legend, e.g. "von Mises stress". */
  label: string;
  /** The backend's own units — MPa, mm, K. Nothing is converted anywhere. */
  unit: string;
  /** One value per node. `NaN` where the quantity was not computed. */
  values: Float32Array;
}

export interface ScaleRange {
  min: number;
  max: number;
  /** True when these bounds were fitted to the data rather than chosen. */
  auto: boolean;
}

export type Rgb = readonly [number, number, number];

/**
 * The colour for a node with no value.
 *
 * Mid grey, deliberately outside every palette below, so an unmeasured region
 * is visibly *not* part of the scale. Amber was the other candidate and is
 * wrong here: `verification-panel` already uses amber for "unmeasured but
 * relevant", and a whole surface of it would read as a warning about the part.
 */
export const ABSENT: Rgb = [0.55, 0.55, 0.55];

/**
 * Palettes as stop lists, interpolated in linear RGB.
 *
 * `damage` is deliberately not the same shape as the others: damage is a
 * fraction of life used, where 1.0 is failure, so its scale runs green-to-red
 * with the interesting end fixed rather than fitted. Reading "the red end" as
 * "the worst in this part" is right for stress and dangerous for damage, where
 * red must mean *spent*.
 */
const PALETTES: Record<FieldKind, readonly Rgb[]> = {
  // Blue → cyan → green → yellow → red. The viewer's existing stress ramp.
  stress: [
    [0.23, 0.3, 0.75],
    [0.0, 0.75, 0.85],
    [0.35, 0.8, 0.3],
    [0.95, 0.85, 0.2],
    [0.8, 0.15, 0.15],
  ],
  displacement: [
    [0.1, 0.1, 0.35],
    [0.25, 0.45, 0.8],
    [0.55, 0.75, 0.95],
    [0.95, 0.95, 0.95],
  ],
  // Thin is the problem, so thin is hot: the ramp is reversed on purpose.
  thickness: [
    [0.8, 0.15, 0.15],
    [0.95, 0.85, 0.2],
    [0.35, 0.8, 0.3],
    [0.2, 0.5, 0.25],
  ],
  damage: [
    [0.2, 0.6, 0.25],
    [0.95, 0.85, 0.2],
    [0.8, 0.15, 0.15],
  ],
  temperature: [
    [0.15, 0.3, 0.7],
    [0.6, 0.6, 0.6],
    [0.85, 0.3, 0.1],
  ],
};

/**
 * Fields whose scale must not be fitted to the data.
 *
 * Damage is a fraction of life: 0 to 1 means something absolute, and fitting
 * 0–0.02 across the full palette paints a part that will last fifty lifetimes
 * in the same red as one about to crack.
 */
export const FIXED_RANGES: Partial<Record<FieldKind, ScaleRange>> = {
  damage: { min: 0, max: 1, auto: false },
};

export function paletteFor(kind: FieldKind): readonly Rgb[] {
  return PALETTES[kind];
}

/**
 * The range to draw this field over.
 *
 * Ignores `NaN`, which is the whole reason it is not `Math.min(...values)`.
 * Returns a degenerate-but-valid range for a constant field, so a uniform part
 * draws in one colour rather than dividing by zero.
 */
export function autoRange(field: ScalarField): ScaleRange {
  const fixed = FIXED_RANGES[field.kind];
  if (fixed) return fixed;

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < field.values.length; i++) {
    const value = field.values[i];
    if (Number.isNaN(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    // Every value was absent. A range over nothing is not 0–1; saying so is the
    // caller's job, and `hasAnyValue` is how they ask.
    return { min: 0, max: 0, auto: true };
  }
  return { min, max, auto: true };
}

export function hasAnyValue(field: ScalarField): boolean {
  for (let i = 0; i < field.values.length; i++) {
    if (!Number.isNaN(field.values[i])) return true;
  }
  return false;
}

/** Where a value sits on the scale, clamped to 0–1. `NaN` stays `NaN`. */
export function normalise(value: number, range: ScaleRange): number {
  if (Number.isNaN(value)) return Number.NaN;
  const span = range.max - range.min;
  if (span <= 0) return 0;
  const t = (value - range.min) / span;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** The colour for one value, or `ABSENT` when there is no value. */
export function colourAt(value: number, range: ScaleRange, kind: FieldKind): Rgb {
  const t = normalise(value, range);
  if (Number.isNaN(t)) return ABSENT;
  return sample(paletteFor(kind), t);
}

/** Linear interpolation along a stop list. `t` is already clamped to 0–1. */
export function sample(stops: readonly Rgb[], t: number): Rgb {
  if (stops.length === 1) return stops[0];
  const scaled = t * (stops.length - 1);
  const index = Math.min(Math.floor(scaled), stops.length - 2);
  const local = scaled - index;
  const a = stops[index];
  const b = stops[index + 1];
  return [
    a[0] + (b[0] - a[0]) * local,
    a[1] + (b[1] - a[1]) * local,
    a[2] + (b[2] - a[2]) * local,
  ];
}

/**
 * Per-node colours for the whole field, ready to upload as a vertex attribute.
 *
 * One pass, one allocation. The absent colour is written like any other, so a
 * partly-computed field draws without the caller branching per node.
 */
export function colourBuffer(field: ScalarField, range: ScaleRange): Float32Array {
  const palette = paletteFor(field.kind);
  const out = new Float32Array(field.values.length * 3);
  for (let i = 0; i < field.values.length; i++) {
    const t = normalise(field.values[i], range);
    const colour = Number.isNaN(t) ? ABSENT : sample(palette, t);
    out[i * 3] = colour[0];
    out[i * 3 + 1] = colour[1];
    out[i * 3 + 2] = colour[2];
  }
  return out;
}

export interface LegendTick {
  value: number;
  label: string;
  /** Position along the bar, 0 at the bottom. */
  at: number;
}

export interface Legend {
  label: string;
  unit: string;
  range: ScaleRange;
  ticks: LegendTick[];
  /** Rendered beside the bar when the bounds were fitted rather than chosen. */
  note: string | null;
  stops: readonly Rgb[];
}

/**
 * The legend for a field, including whether its bounds were somebody's decision.
 *
 * The `note` is not decoration. A reader comparing two screenshots of the same
 * part needs to know whether the colours mean the same thing in both, and with
 * a fitted range they do not.
 */
export function legendFor(field: ScalarField, range: ScaleRange, ticks = 5): Legend {
  const count = Math.max(2, ticks);
  const span = range.max - range.min;
  return {
    label: field.label,
    unit: field.unit,
    range,
    stops: paletteFor(field.kind),
    ticks: Array.from({ length: count }, (_, index) => {
      const at = index / (count - 1);
      const value = range.min + span * at;
      return { value, at, label: formatTick(value, span) };
    }),
    note: range.auto
      ? "Scale fitted to this result — the same colour means a different value on another run."
      : null,
  };
}

function formatTick(value: number, span: number): string {
  if (span === 0) return value.toPrecision(3);
  const magnitude = Math.abs(span);
  const decimals = magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : magnitude >= 1 ? 2 : 4;
  return value.toFixed(decimals);
}

export interface Probe {
  nodeIndex: number;
  value: number;
  /** The field's own unit, so a caller cannot label it with another's. */
  unit: string;
  label: string;
  /** False when this node carries no value — never reported as 0. */
  measured: boolean;
}

/**
 * Read one node's value, for "what is it here?".
 *
 * Returns `measured: false` rather than a zero for an absent value, and throws
 * for a node index that is not in the field — a probe that silently answered
 * about the wrong node would be worse than one that failed, because the number
 * it returns looks exactly like an answer.
 */
export function probeNode(field: ScalarField, nodeIndex: number): Probe {
  if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= field.values.length) {
    throw new RangeError(
      `Node ${nodeIndex} is not in this field, which has ${field.values.length} nodes.`,
    );
  }
  const value = field.values[nodeIndex];
  return {
    nodeIndex,
    value,
    unit: field.unit,
    label: field.label,
    measured: !Number.isNaN(value),
  };
}

/**
 * The magnitude of a per-node vector, as a scalar field.
 *
 * The bridge from what a solve returns (displacement as xyz per node) to what
 * this module draws. Kept here rather than in `surface-field.ts` because it is
 * a presentation choice: the magnitude is what a colour bar can show, and the
 * direction is what an arrow glyph would.
 */
export function magnitudeField(
  triples: Float32Array,
  kind: FieldKind,
  label: string,
  unit: string,
): ScalarField {
  const count = Math.floor(triples.length / 3);
  const values = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = triples[i * 3];
    const y = triples[i * 3 + 1];
    const z = triples[i * 3 + 2];
    values[i] = Math.sqrt(x * x + y * y + z * z);
  }
  return { kind, label, unit, values };
}
