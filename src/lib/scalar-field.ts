/**
 * A per-node scalar field as something a viewer can colour — P6 task 5.
 *
 * **A sibling of `surface-field.ts`, not a widening of it.** That module is a *wire
 * format* — a packed binary header with a JSON fallback — and this one is *presentation*.
 * Merging them would put a palette in a decoder and a byte offset in a legend.
 *
 * Five kinds — stress, displacement, thickness, damage, temperature — differ by a name, a
 * unit and a palette, **never by a second renderer**. `magnitudeField` is the bridge from
 * what a solve returns (three numbers per node) to what a colour bar can show (one).
 *
 * Three honesty rules, each of which is the reason a plausible picture would otherwise be
 * wrong:
 *
 * 1. **An unmeasured node is `NaN` and gets `ABSENT` grey**, not the bottom of the scale,
 *    and it is left out of the fitted range. The bottom of the scale is a reading; "nobody
 *    computed this" is not one, and painting the second as the first is how a hole in a
 *    result set becomes a region of low stress. `probeNode` answers `measured: false`
 *    rather than `0`.
 * 2. **A fitted range says it was fitted.** `auto: true` travels with it and the legend
 *    prints the caveat, so a reader comparing two screenshots knows the colours do not
 *    mean the same thing in both — which is the single easiest way to mislead with a
 *    correct picture.
 * 3. **Damage is never fitted.** `FIXED_RANGES` pins it to 0–1, because fitting 0–0.02
 *    across the palette paints a part that will last fifty lifetimes in the same red as
 *    one about to crack.
 *
 * Thickness's ramp is **reversed on purpose** — thin is the problem — which is exactly the
 * assumption a caller who has read "high is red" everywhere else would get wrong, so it is
 * a property of the kind rather than a flag at the call site.
 *
 * No runtime dependency is added; the palettes are arithmetic. The doctrine is three.
 *
 * Rebuilt 2026-09-17. The master plan claimed this module on 2026-09-16 and it had never
 * been committed; the rules above are what that status recorded.
 */

export type FieldKind =
  | "stress"
  | "displacement"
  | "thickness"
  | "damage"
  | "temperature";

export interface FieldDefinition {
  readonly kind: FieldKind;
  /** What a legend calls it. */
  readonly label: string;
  /** The unit, in the mm-N-MPa system the whole product uses. */
  readonly unit: string;
  /** True when low values are the concern, so the ramp runs the other way. */
  readonly lowIsBad: boolean;
}

export const FIELDS: Readonly<Record<FieldKind, FieldDefinition>> = {
  stress: { kind: "stress", label: "von Mises stress", unit: "MPa", lowIsBad: false },
  displacement: { kind: "displacement", label: "Displacement", unit: "mm", lowIsBad: false },
  // Thin is the problem, so the ramp is reversed. A property of the kind, never a flag a
  // caller has to remember.
  thickness: { kind: "thickness", label: "Wall thickness", unit: "mm", lowIsBad: true },
  damage: { kind: "damage", label: "Fatigue damage", unit: "", lowIsBad: false },
  temperature: { kind: "temperature", label: "Temperature", unit: "K", lowIsBad: false },
};

/**
 * Ranges that must never be fitted to the data.
 *
 * Damage is the one that matters: 1.0 is the whole meaning of the quantity — the point at
 * which the life is used up — and fitting 0–0.02 across the palette paints a part that
 * will last fifty lifetimes in the same red as one about to crack.
 */
export const FIXED_RANGES: Partial<Record<FieldKind, Range>> = {
  damage: { min: 0, max: 1, auto: false },
};

export interface Range {
  readonly min: number;
  readonly max: number;
  /** True when these bounds were fitted to the data rather than chosen. */
  readonly auto: boolean;
}

/** The colour an unmeasured node gets. Grey, and never a colour on the ramp. */
export const ABSENT: readonly [number, number, number] = [0.62, 0.62, 0.64];

/** One node's value, or `NaN` where nothing was computed. */
export type Field = readonly number[];

/**
 * The magnitude of a three-component result, per node — the bridge from a solve's output
 * to something a colour bar can show.
 *
 * A node whose components are not all finite comes out `NaN` rather than a partial
 * magnitude, because a displacement with one missing component is not a short
 * displacement.
 */
export function magnitudeField(vectors: readonly (readonly number[])[]): number[] {
  return vectors.map((vector) => {
    if (vector.length !== 3 || !vector.every((component) => Number.isFinite(component))) {
      return Number.NaN;
    }
    return Math.hypot(vector[0], vector[1], vector[2]);
  });
}

/**
 * The range to colour a field over.
 *
 * `NaN` nodes are excluded from the fit — including them would need a value for them, and
 * any value is a reading nobody took. A field with nothing measured in it gets 0–1 and
 * says it was fitted, because there is no honest alternative and a legend showing 0–0 is
 * worse than one showing a caveat.
 */
export function rangeFor(kind: FieldKind, field: Field): Range {
  const fixed = FIXED_RANGES[kind];
  if (fixed !== undefined) return fixed;
  const measured = field.filter((value) => Number.isFinite(value));
  if (measured.length === 0) return { min: 0, max: 1, auto: true };
  const min = Math.min(...measured);
  const max = Math.max(...measured);
  // A constant field has no spread to colour. Widening it by a hair would paint noise
  // across the whole palette; giving it a band keeps everything one colour, which is the
  // truth about a constant field.
  if (min === max) return { min, max: min + 1, auto: true };
  return { min, max, auto: true };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Where a value sits on its ramp, 0 to 1, or `null` when it was never measured.
 *
 * `null` rather than 0: the caller has to decide to paint `ABSENT`, and a function that
 * returned 0 would let it forget.
 */
export function normalise(value: number, range: Range, kind: FieldKind): number | null {
  if (!Number.isFinite(value)) return null;
  const span = range.max - range.min;
  const position = span === 0 ? 0 : (value - range.min) / span;
  const clamped = clamp01(position);
  return FIELDS[kind].lowIsBad ? 1 - clamped : clamped;
}

/**
 * A blue-to-red ramp, as arithmetic.
 *
 * Deliberately simple and deliberately not a perceptual colour space: the legend carries
 * the numbers, and a viewer reads a picture against the legend rather than by naming a
 * colour. A dependency for this would be a dependency for arithmetic.
 */
export function ramp(position: number): [number, number, number] {
  const t = clamp01(position);
  // Blue → cyan → green → yellow → red, in four linear segments.
  if (t < 0.25) return [0, 4 * t, 1];
  if (t < 0.5) return [0, 1, 1 - 4 * (t - 0.25)];
  if (t < 0.75) return [4 * (t - 0.5), 1, 0];
  return [1, 1 - 4 * (t - 0.75), 0];
}

/** The colour for one node: its ramp position, or `ABSENT` grey when unmeasured. */
export function colourFor(
  value: number,
  range: Range,
  kind: FieldKind,
): readonly [number, number, number] {
  const position = normalise(value, range, kind);
  return position === null ? ABSENT : ramp(position);
}

/** Every node's colour, flat, ready for a vertex buffer. */
export function colourField(
  field: Field,
  kind: FieldKind,
  range: Range = rangeFor(kind, field),
): number[] {
  const out: number[] = [];
  for (const value of field) {
    const [r, g, b] = colourFor(value, range, kind);
    out.push(r, g, b);
  }
  return out;
}

export interface Probe {
  readonly node: number;
  readonly measured: boolean;
  readonly value: number | null;
  /** What to show: the value with its unit, or why there is nothing. */
  readonly text: string;
}

/**
 * What one node reads.
 *
 * **`measured: false` rather than `0`**, and a node index outside the field is refused
 * rather than clamped: a probe that answers about the nearest node it does have is
 * answering a question nobody asked, at a point the user pointed at.
 */
export function probeNode(field: Field, kind: FieldKind, node: number): Probe {
  const definition = FIELDS[kind];
  if (!Number.isInteger(node) || node < 0 || node >= field.length) {
    return {
      node,
      measured: false,
      value: null,
      text: `There is no node ${node} in this field.`,
    };
  }
  const value = field[node];
  if (!Number.isFinite(value)) {
    return {
      node,
      measured: false,
      value: null,
      text: `${definition.label} was not computed at this node.`,
    };
  }
  const unit = definition.unit ? ` ${definition.unit}` : "";
  return {
    node,
    measured: true,
    value,
    text: `${definition.label}: ${value.toPrecision(4)}${unit}`,
  };
}

export interface Legend {
  readonly label: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  /** The caveat to print, or `null` when the bounds were chosen rather than fitted. */
  readonly caveat: string | null;
  /** Ticks from min to max, evenly spaced, for the bar's labels. */
  readonly ticks: readonly number[];
  readonly absentNote: string | null;
}

/**
 * The legend beside the colour bar.
 *
 * It states its own bounds and whether they were fitted, because two screenshots of the
 * same part with different auto-fitted ranges look like two different results — the
 * easiest way to mislead with a picture that is individually correct.
 */
export function legendFor(kind: FieldKind, field: Field, range = rangeFor(kind, field)): Legend {
  const definition = FIELDS[kind];
  const steps = 5;
  const ticks = Array.from(
    { length: steps },
    (_, index) => range.min + ((range.max - range.min) * index) / (steps - 1),
  );
  const absent = field.filter((value) => !Number.isFinite(value)).length;
  return {
    label: definition.label,
    unit: definition.unit,
    min: range.min,
    max: range.max,
    caveat: range.auto
      ? "Scale fitted to this result. Two views with different scales are not comparable."
      : null,
    ticks,
    absentNote:
      absent > 0
        ? `${absent} node${absent === 1 ? "" : "s"} shown grey: not computed, not zero.`
        : null,
  };
}
