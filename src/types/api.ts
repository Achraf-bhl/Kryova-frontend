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
    };

export interface Fixture {
  where: Selector;
  dofs: Array<"x" | "y" | "z">;
  name?: string;
}

export interface Load {
  where: Selector;
  force_n: [number, number, number];
  name?: string;
}

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
