export interface UserRead {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  created_at: string;
}


export interface ProjectRead {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectCreate {
  name: string;
  description?: string | null;
}

export interface GeometryVersionRead {
  id: string;
  project_id: string;
  media_id: string;
  version_number: number;
  filename: string;
  file_format: string;
  size_bytes: number;
  checksum_sha256: string;
  note: string | null;
  stats: Record<string, unknown>;
  created_at: string;
}

export interface Material {
  name: string;
  youngs_modulus_mpa: number;
  poissons_ratio: number;
  yield_strength_mpa: number;
  density_kg_m3: number;
}

/**
 * How a load or restraint names the region it applies to.
 *
 * Mirrors `app/solve/types.py`. Every variant resolves server-side to a set of
 * mesh nodes; what differs is how the region is described to someone who cannot
 * see the mesh.
 */
export type Selector =
  | {
      type: "face";
      axis: "x" | "y" | "z";
      side: "min" | "max";
      tolerance?: number;
    }
  | {
      type: "box";
      min: [number, number, number];
      max: [number, number, number];
    }
  | {
      /** The wall of a hole or a shaft seat -- what a bolt hole actually is. */
      type: "cylinder";
      axis_point: [number, number, number];
      axis_direction: [number, number, number];
      radius: number;
      radius_tolerance?: number;
      length?: number | null;
    }
  | {
      type: "sphere";
      centre: [number, number, number];
      radius: number;
    }
  | {
      /** Every node. Only meaningful for the body loads: gravity, centrifugal. */
      type: "body";
    };

export type SelectorType = Selector["type"];

/** Named restraint patterns. `custom` means "use `dofs` as given". */
export type FixtureKind = "clamp" | "roller" | "slider" | "symmetry" | "custom";

export interface Fixture {
  where: Selector;
  /**
   * Which translations are held. Omit when `kind` is not `custom` -- the server
   * derives it, and a value that disagrees with `kind` is refused.
   */
  dofs?: Array<"x" | "y" | "z">;
  kind?: FixtureKind;
  /** The axis a roller, slider or symmetry restraint is normal to. */
  normal?: "x" | "y" | "z";
  name?: string;
}

/**
 * The load types the solver understands.
 *
 * `type` is required on every new load. The server still accepts a load with no
 * `type` and reads it as a force -- that is what keeps simulations saved before
 * this union existed re-solving to the same answer -- but nothing here should
 * rely on it.
 */
export type Load =
  | {
      type: "force";
      where: Selector;
      /** Total force in newtons, spread over the region by tributary area. */
      force_n: [number, number, number];
      name?: string;
    }
  | {
      type: "pressure";
      where: Selector;
      /** MPa along the surface's own normal. Positive pushes inward. */
      pressure_mpa: number;
      name?: string;
    }
  | {
      type: "moment";
      where: Selector;
      /** N-mm about an axis through the region's centroid. */
      moment_n_mm: [number, number, number];
      name?: string;
    }
  | {
      /** A pin bearing on a bore. Needs a cylinder selector. */
      type: "bearing";
      where: Selector;
      force_n: [number, number, number];
      /** Cosine exponent; 1.0 is the classical distribution. */
      distribution?: number;
      name?: string;
    }
  | {
      type: "gravity";
      direction?: [number, number, number];
      /** mm/s^2. Defaults to standard gravity, 9806.65. */
      magnitude_mm_s2?: number;
      name?: string;
    }
  | {
      type: "centrifugal";
      axis_point: [number, number, number];
      axis_direction: [number, number, number];
      rpm: number;
      name?: string;
    };

export type LoadType = Load["type"];

/** Standard gravity in mm/s^2, matching `STANDARD_GRAVITY_MM_S2` server-side. */
export const STANDARD_GRAVITY_MM_S2 = 9806.65;

export interface LoadCasePayload {
  name: string;
  material: Material;
  fixtures: Fixture[];
  loads: Load[];
}

/**
 * Job status, spelled exactly as the API serialises it.
 *
 * These are LOWERCASE because `app/models/simulation.py` declares
 * `JobStatus(str, enum.Enum)` with lowercase values, and Pydantic serialises a
 * str-enum by value. They were uppercase here for a long time, which meant
 * `status === "SUCCEEDED"` was never true: the results page never fetched the
 * surface field, the stress viewer never rendered, and every finished job
 * polled until the 30-minute ceiling. The whole test suite stayed green because
 * every fixture was written against this file rather than against the server.
 *
 * If you change these, change `app/models/simulation.py` in the same commit.
 */
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

/** Statuses after which a job will never change again. */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ["succeeded", "failed"];

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}

/** Human-facing label for a status the API returned. */
export function jobStatusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Solving";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

export interface SimulationRead {
  id: string;
  project_id: string;
  geometry_version_id: string;
  status: JobStatus;
  solver: string;
  load_case: Record<string, unknown>;
  element_size_mm: number | null;
  mesh_stats: Record<string, unknown> | null;
  result: StaticResult | null;
  fields_media_id: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface SimulationCreate {
  geometry_version?: number | null;
  load_case: LoadCasePayload;
  element_size_mm?: number | null;
  /**
   * 1 for linear tets, 2 for quadratic (tet10).
   *
   * The server has accepted this since tet10 landed; this file did not declare
   * it, so the UI had no way to ask for quadratic elements and every job ran
   * linear -- which is markedly too stiff in bending. Mirrors
   * `app/schemas/simulation.py`.
   */
  element_order?: 1 | 2;
}

export interface StaticResult {
  max_displacement_mm: number;
  max_von_mises_mpa: number;
  factor_of_safety: number;
  yields: boolean;
  mass_kg: number;
  volume_mm3: number;
  node_count: number;
  element_count: number;
  solve_seconds: number;
  warnings: string[];
}

export interface SurfaceField {
  node_positions: number[][];
  triangles: number[][];
  displacements: number[][];
  von_mises_mpa: number[];
  max_von_mises_mpa: number;
  max_displacement_mm: number;
}


/** Whether the AI features can serve a request, and which model would answer. */
export interface AIStatus {
  enabled: boolean;
  provider: string;
  model: string;
  detail: string | null;
}

export interface Finding {
  title: string;
  detail: string;
  severity: "critical" | "warning" | "info";
}

export interface DesignSuggestion {
  change: string;
  rationale: string;
  tradeoff: string;
}

/** A structural engineer's read of one completed run. */
export interface ResultInterpretation {
  verdict: "safe" | "marginal" | "yields";
  headline: string;
  findings: Finding[];
  suggestions: DesignSuggestion[];
  confidence: "high" | "medium" | "low";
  caveat: string;
}
