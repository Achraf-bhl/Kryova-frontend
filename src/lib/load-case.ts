/**
 * Building a load case: defaults, editing, validation, and the payload.
 *
 * All of it pure, and deliberately out of the React tree. The editor used to
 * hold one fixture and one load as sixteen flat `useState` strings, which is
 * why it could only ever express one of each -- there was nowhere to put a
 * second. Modelling a load case as data makes N of each fall out for free, and
 * makes the part worth testing testable without rendering anything.
 *
 * Mirrors `app/solve/types.py`. Nothing here converts units: lengths are mm,
 * forces N, pressures MPa, moments N-mm, exactly as the solver reads them.
 */

import type {
  Fixture,
  FixtureKind,
  Load,
  LoadCasePayload,
  LoadType,
  Material,
  Selector,
  SelectorType,
} from "@/types/api";
import { STANDARD_GRAVITY_MM_S2 } from "@/types/api";

/** A row in the editor. `id` is local only and never reaches the API. */
export interface Identified {
  id: string;
}

export type FixtureRow = Identified & Fixture;
export type LoadRow = Identified & Load;

let counter = 0;

/**
 * A stable key for a new row.
 *
 * A counter rather than the array index, because rows get deleted from the
 * middle: with an index key React reuses the removed row's DOM node for its
 * successor and the wrong input keeps focus mid-edit.
 */
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

// -- selectors ---------------------------------------------------------------

export const SELECTOR_LABELS: Record<SelectorType, string> = {
  face: "Bounding-box face",
  box: "Region box",
  cylinder: "Cylinder (hole or shaft)",
  sphere: "Sphere",
  body: "Whole body",
};

/**
 * Which regions each load type may act on.
 *
 * Not cosmetic filtering: a pressure needs a real surface, and a bearing load
 * needs a bore whose axis says which half of it carries the load. Offering
 * those combinations and letting the server refuse them costs a round trip to
 * learn something the UI already knows.
 */
export const SELECTORS_FOR_LOAD: Record<LoadType, SelectorType[]> = {
  force: ["face", "box", "cylinder", "sphere"],
  pressure: ["face", "cylinder", "sphere"],
  moment: ["face", "box", "cylinder"],
  bearing: ["cylinder"],
  gravity: [],
  centrifugal: [],
};

/** Load types that act on the whole body and so carry no region at all. */
export const BODY_LOADS: LoadType[] = ["gravity", "centrifugal"];

export function isBodyLoad(load: Pick<Load, "type">): boolean {
  return BODY_LOADS.includes(load.type);
}

export function defaultSelector(type: SelectorType): Selector {
  switch (type) {
    case "face":
      return { type: "face", axis: "z", side: "min" };
    case "box":
      return { type: "box", min: [0, 0, 0], max: [0, 0, 0] };
    case "cylinder":
      return {
        type: "cylinder",
        axis_point: [0, 0, 0],
        axis_direction: [0, 0, 1],
        radius: 5,
        radius_tolerance: 0.5,
      };
    case "sphere":
      return { type: "sphere", centre: [0, 0, 0], radius: 5 };
    case "body":
      return { type: "body" };
  }
}

// -- fixtures ----------------------------------------------------------------

export const FIXTURE_KIND_LABELS: Record<FixtureKind, string> = {
  clamp: "Clamp — holds all three translations",
  roller: "Roller — holds one axis, free to slide in the plane",
  slider: "Slider — free along one axis, held in the other two",
  symmetry: "Symmetry plane — the same restraint as a roller",
  custom: "Custom — choose the axes yourself",
};

/** The degrees of freedom a kind implies, mirroring the server's rule. */
export function impliedDofs(
  kind: FixtureKind,
  normal: "x" | "y" | "z" | undefined,
): Array<"x" | "y" | "z"> | null {
  if (kind === "custom") return null;
  if (kind === "clamp") return ["x", "y", "z"];
  if (!normal) return null;
  if (kind === "roller" || kind === "symmetry") return [normal];
  return (["x", "y", "z"] as const).filter((axis) => axis !== normal);
}

export function newFixture(): FixtureRow {
  return {
    id: nextId("fixture"),
    where: defaultSelector("face"),
    kind: "clamp",
    name: "",
  };
}

// -- loads -------------------------------------------------------------------

export const LOAD_TYPE_LABELS: Record<LoadType, string> = {
  force: "Force — a total in newtons, spread over the region",
  pressure: "Pressure — MPa along the surface normal, scales with area",
  moment: "Moment — a torque about the region's centroid",
  bearing: "Bearing — a pin's load on a bore, peaking at the contact",
  gravity: "Gravity — self-weight of the whole part",
  centrifugal: "Centrifugal — rotation about an axis",
};

export function newLoad(type: LoadType = "force"): LoadRow {
  return { id: nextId("load"), ...blankLoad(type) };
}

/**
 * A load of `type` with sensible defaults, keeping the region where one applies.
 *
 * Switching force → pressure should not silently drop the face the user already
 * chose; switching either → gravity must drop it, because a body load has no
 * region and sending one would be refused.
 */
export function changeLoadType(load: LoadRow, type: LoadType): LoadRow {
  const previous = "where" in load ? load.where : undefined;
  const next = blankLoad(type);
  if ("where" in next && previous && SELECTORS_FOR_LOAD[type].includes(previous.type)) {
    next.where = previous;
  }
  return { ...next, id: load.id, name: load.name };
}

function blankLoad(type: LoadType): Load {
  switch (type) {
    case "force":
      return { type: "force", where: defaultSelector("face"), force_n: [0, 0, -1000] };
    case "pressure":
      return { type: "pressure", where: defaultSelector("face"), pressure_mpa: 1 };
    case "moment":
      return { type: "moment", where: defaultSelector("face"), moment_n_mm: [0, 0, 1000] };
    case "bearing":
      return { type: "bearing", where: defaultSelector("cylinder"), force_n: [1000, 0, 0], distribution: 1 };
    case "gravity":
      return { type: "gravity", direction: [0, 0, -1], magnitude_mm_s2: STANDARD_GRAVITY_MM_S2 };
    case "centrifugal":
      return { type: "centrifugal", axis_point: [0, 0, 0], axis_direction: [0, 0, 1], rpm: 1000 };
  }
}

// -- validation --------------------------------------------------------------

/**
 * Everything wrong with the case, as messages a user can act on.
 *
 * Checked here rather than left to the server for one reason: the server
 * answers with the first failure only, and it answers after a round trip. A
 * form that lists all four problems at once is the difference between one
 * correction and four.
 */
export function validateLoadCase(
  fixtures: FixtureRow[],
  loads: LoadRow[],
  material: Material | undefined,
): string[] {
  const problems: string[] = [];

  if (!material) problems.push("Choose a material.");
  if (fixtures.length === 0) problems.push("Add at least one fixture, or the part will fly off.");
  if (loads.length === 0) problems.push("Add at least one load.");

  fixtures.forEach((fixture, index) => {
    const where = `Fixture ${index + 1}`;
    const kind = fixture.kind ?? "custom";
    if (kind !== "clamp" && kind !== "custom" && !fixture.normal) {
      problems.push(`${where}: a ${kind} needs the axis it holds.`);
    }
    if (kind === "custom" && (fixture.dofs ?? []).length === 0) {
      problems.push(`${where}: hold at least one axis, or it restrains nothing.`);
    }
    problems.push(...selectorProblems(fixture.where, where));
  });

  loads.forEach((load, index) => {
    const where = `Load ${index + 1}`;
    if ("where" in load) problems.push(...selectorProblems(load.where, where));

    if (load.type === "force" && isZeroVector(load.force_n)) {
      problems.push(`${where}: a force of zero applies nothing.`);
    }
    if (load.type === "moment" && isZeroVector(load.moment_n_mm)) {
      problems.push(`${where}: a moment of zero applies nothing.`);
    }
    if (load.type === "bearing") {
      if (isZeroVector(load.force_n)) problems.push(`${where}: a bearing force of zero applies nothing.`);
      if (load.where.type !== "cylinder") {
        problems.push(
          `${where}: a bearing load needs a cylinder region — it is the bore's axis ` +
            "that decides which half carries the load.",
        );
      }
    }
    if (load.type === "pressure" && load.pressure_mpa === 0) {
      problems.push(`${where}: a pressure of zero applies nothing.`);
    }
    if (load.type === "gravity" && isZeroVector(load.direction ?? [0, 0, -1])) {
      problems.push(`${where}: a gravity direction of zero has no direction.`);
    }
    if (load.type === "centrifugal") {
      if (load.rpm <= 0) problems.push(`${where}: rotation speed must be above zero.`);
      if (isZeroVector(load.axis_direction)) problems.push(`${where}: the rotation axis has no direction.`);
    }
  });

  return problems;
}

function selectorProblems(selector: Selector, label: string): string[] {
  switch (selector.type) {
    case "box": {
      const inverted = selector.min.some((value, axis) => value > selector.max[axis]);
      return inverted ? [`${label}: the box's minimum corner is above its maximum.`] : [];
    }
    case "cylinder": {
      const problems: string[] = [];
      if (selector.radius <= 0) problems.push(`${label}: the cylinder's radius must be above zero.`);
      if (isZeroVector(selector.axis_direction)) problems.push(`${label}: the cylinder's axis has no direction.`);
      return problems;
    }
    case "sphere":
      return selector.radius <= 0 ? [`${label}: the sphere's radius must be above zero.`] : [];
    default:
      return [];
  }
}

function isZeroVector(vector: readonly number[]): boolean {
  return vector.every((component) => component === 0);
}

// -- the payload -------------------------------------------------------------

/**
 * Strip the editor's local ids and empty names, leaving what the API expects.
 *
 * An empty `name` is dropped rather than sent: the server treats a name as
 * optional, and `""` would show up in results as an unnamed-but-present label.
 */
export function toPayload(
  name: string,
  material: Material,
  fixtures: FixtureRow[],
  loads: LoadRow[],
): LoadCasePayload {
  return {
    name: name.trim() || "Load case",
    material,
    fixtures: fixtures.map((fixture) => strip(fixture) as Fixture),
    loads: loads.map((load) => strip(load) as Load),
  };
}

/**
 * Drop the editor's local `id` and any blank `name`.
 *
 * Built by copying the keys worth keeping rather than by destructuring the ones
 * to discard: `const { id: _id, ...rest }` reads as a discard to a person and
 * as an unused variable to the linter, and silencing that with an underscore
 * convention only works until someone changes the rule.
 */
function strip<T extends Identified & { name?: string }>(row: T): Omit<T, "id"> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "id") continue;
    if (key === "name" && (typeof value !== "string" || value.trim() === "")) continue;
    out[key] = value;
  }
  return out as Omit<T, "id">;
}
