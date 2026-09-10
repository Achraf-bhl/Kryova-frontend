export interface UserRead {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  created_at: string;
  /** P1.5 — false until the address has been confirmed. Gates project creation only. */
  is_verified: boolean;
}

/**
 * P1.7 — what `/auth/login` answers when the password was right and a second
 * factor is still owed. **No cookies are set with this**, and the token grants
 * nothing: the backend refuses its type everywhere a session is expected.
 */
export interface MfaChallenge {
  mfa_required: true;
  challenge_token: string;
  expires_in_seconds: number;
  recovery_available: boolean;
}

/**
 * `/auth/login` returns one of two shapes. Narrow on `mfa_required` rather than
 * on which keys are present — a check like `"user" in result` reads a missing
 * key as a challenge and vice versa, silently, on the one route where being
 * wrong means showing a signed-out user a dashboard.
 */
export type LoginResult = { user: UserRead; csrf_token: string } | MfaChallenge;

export function isMfaChallenge(result: LoginResult): result is MfaChallenge {
  return (result as MfaChallenge).mfa_required === true;
}

/** One signed-in device, as `/auth/sessions` reports it (P1.3). */
export interface DeviceSession {
  id: string;
  device_label: string | null;
  ip_address: string | null;
  created_at: string;
  last_used_at: string;
  absolute_expires_at: string;
  /** Computed per request — "this device" is a property of who is asking. */
  current: boolean;
}

export interface VerificationStatus {
  verified: boolean;
  can_resend_in_seconds: number;
  /** False when this deployment has no transport that reaches a real mailbox. */
  delivery_available: boolean;
}

export interface MfaStatus {
  enabled: boolean;
  /** Started but never confirmed — the state a user gets stuck in. */
  pending: boolean;
  recovery_codes_remaining: number;
}

export interface MfaEnrolment {
  secret: string;
  provisioning_uri: string;
  recovery_codes: string[];
}


export interface ProjectRead {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  /**
   * The tenant that owns this project and gets billed for runs against it.
   *
   * Added with P5.7 — the cost estimate is per organisation, so a page holding
   * only a project id could not ask what a run would cost. Not the same fact as
   * `owner_id`: since P2 a project belongs to an organisation and can be
   * transferred between them, and the two only coincide on a personal team.
   */
  organisation_id: string;
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
  /**
   * Which named recipe in `app/solve/load_library.py` produced these loads, and
   * with what factor (E12.1).
   *
   * **`null` means hand-authored, never "unknown".** A case somebody typed has
   * no recipe behind it, and the UI must not render an absent provenance as a
   * missing citation — it is the honest state for most cases today.
   */
  provenance?: Record<string, unknown> | null;
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
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/**
 * Statuses after which a job will never change again.
 *
 * `cancelled` is terminal (P5.6) and is **not** a kind of `failed`. Every
 * surface that groups the two is wrong: a failure is the product not working,
 * and a cancellation is the product doing what it was told. Counting them
 * together makes a user who changes their mind twice look like an incident.
 */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
];

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
    case "cancelled":
      return "Stopped";
    default:
      return status;
  }
}

/** The stages a run passes through, in order. Mirrors `app/simulation/progress.py`. */
export type SimulationStage = "meshing" | "solving" | "reading" | "storing";

export interface SimulationProgress {
  stage: SimulationStage;
  /** Free text: element count, element size. Empty when there is nothing to add. */
  detail: string;
  /** Which grid of a convergence study. Null together with `total`. */
  index: number | null;
  total: number | null;
  at: string;
}

/**
 * One line for a person, from a progress snapshot.
 *
 * Returns `""` for a run that has not reported — rendered as "starting", never
 * as stage zero of four, which would claim a stage had begun. Mirrors
 * `progress.describe` on the backend; the two say the same thing so a log line
 * and the screen never disagree about where a run got to.
 */
export function describeProgress(progress: SimulationProgress | null): string {
  if (!progress) return "";
  const labels: Record<SimulationStage, string> = {
    meshing: "Building the mesh",
    solving: "Solving",
    reading: "Reading the results",
    storing: "Storing the field data",
  };
  let line: string = labels[progress.stage] ?? progress.stage;
  // A count of one is noise dressed as information.
  if (progress.index !== null && progress.total !== null && progress.total > 1) {
    line += ` — grid ${progress.index} of ${progress.total}`;
  }
  return progress.detail ? `${line} (${progress.detail})` : line;
}

export interface SimulationRead {
  id: string;
  project_id: string;
  geometry_version_id: string;
  status: JobStatus;
  solver: string;
  load_case: Record<string, unknown> | null;
  element_size_mm: number | null;
  mesh_stats: Record<string, unknown> | null;
  /**
   * Where a running job has got to (P5.2), or `null` before it reports.
   *
   * **There is no percentage in here on purpose.** For the linear-static
   * workload CalculiX reports a single increment, so a fraction inside a solve
   * would be invented — and an invented progress bar over a twenty-minute solve
   * teaches a user to predict a finish time nobody measured. A convergence
   * study does have countable progress, so it gets `index`/`total`; everything
   * else gets a stage and nothing more.
   *
   * `index` and `total` are present together or not at all: the backend refuses
   * half a count rather than shipping a numerator with no denominator.
   */
  progress: SimulationProgress | null;
  result: StaticResult | null;
  fields_media_id: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;

  // Four fields the backend has returned since the plane-stress and
  // convergence-study work and this mirror never gained. Found 2026-09-10 by
  // `tsc` when the verification panel read `grids`; they were in
  // `app/schemas/simulation.py::SimulationRead` all along. This is the drift
  // CLAUDE.md warns about — nothing generates or verifies this file — so diff
  // it against the Pydantic model when touching either side.
  /** 1 for linear tets, 2 for quadratic (tet10). */
  element_order: number;
  /** Grids in a convergence study. 1 is a single solve and is never `converged`. */
  grids: number;
  /** `"linear-static" | "modal" | "buckling" | "thermal-conduction" | "plane-stress" | "plane-strain"` */
  analysis: string;
  /** Required on a plane run, refused on a solid one. Every plane stress scales with it. */
  thickness_mm: number | null;
  /** Present only on a conduction run; a sibling of `load_case`, not part of it. */
  thermal_case?: Record<string, unknown> | null;
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

// ---------------------------------------------------------------------------
// Organisations, members and invitations (P2)
// ---------------------------------------------------------------------------

/**
 * Platform roles govern the *organisation* — billing, members, deletion.
 * Domain roles govern the *work* and are separate on purpose: a reviewer who
 * approves a gate does not thereby get to change who is in the team, and an
 * owner who pays the bill is not automatically qualified to sign off a design.
 */
export type OrgRole = "owner" | "admin" | "member" | "viewer";
export type DomainRole = "engineer" | "reviewer" | "operator";

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  is_personal: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrganisationMembership extends Organisation {
  role: OrgRole;
  domain_role: DomainRole | null;
}

export interface Member {
  user_id: string;
  email: string;
  full_name: string | null;
  role: OrgRole;
  domain_role: DomainRole | null;
}

export interface Invitation {
  id: string;
  organisation_id: string;
  email: string;
  role: OrgRole;
  domain_role: DomainRole | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/**
 * `token` is present **only when the invitation email did not reach a
 * mailbox** — a deployment with no SMTP transport, or a send that failed. When
 * it is there the UI has to show it, because it is the only copy and the
 * invitee has no other way to get one.
 */
export interface InvitationIssued extends Invitation {
  token: string | null;
}

// ---------------------------------------------------------------------------
// Sharing (P2.5)
// ---------------------------------------------------------------------------

export interface ShareLink {
  id: string;
  label: string | null;
  note: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  allow_geometry_download: boolean;
  view_count: number;
  last_viewed_at: string | null;
}

/** The one response carrying the raw token. It is not recoverable afterwards. */
export interface ShareLinkIssued extends ShareLink {
  token: string;
  url: string;
}

export interface SharedGeometry {
  version_number: number;
  filename: string | null;
  created_at: string;
  size_bytes: number | null;
}

export interface SharedSimulation {
  analysis: string;
  status: string;
  created_at: string;
  max_von_mises_mpa: number | null;
  max_displacement_mm: number | null;
  mass_kg: number | null;
  /** `single-grid` is not a pass — never render it as one. */
  mesh_convergence: string | null;
  solver: string | null;
}

export interface SharedPackage {
  project_name: string;
  project_description: string | null;
  organisation_name: string;
  shared_by: string;
  label: string | null;
  note: string | null;
  expires_at: string;
  allow_geometry_download: boolean;
  geometry: SharedGeometry[];
  simulations: SharedSimulation[];
}

export interface ProjectTransfer {
  id: string;
  from_organisation_id: string;
  to_organisation_id: string;
  transferred_by_id: string;
  reason: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Platform state (P3.5, P3.7)
// ---------------------------------------------------------------------------

export type AnnouncementLevel = "info" | "warning" | "critical";

export interface Announcement {
  id: string;
  message: string;
  level: AnnouncementLevel;
  starts_at: string;
  ends_at: string | null;
  withdrawn_at: string | null;
}

export interface MaintenanceNotice {
  message: string;
  expected_end_at: string | null;
}

/**
 * Everything the shell needs before it renders (P3.5, P3.7).
 *
 * **`flags` is resolved by the server and must never be re-decided here.** A
 * flag the UI evaluates differently from the API is a feature that is half on:
 * a button whose endpoint refuses, or an endpoint nobody can reach. One
 * evaluator, `app/core/flags.py`, and this is its answer.
 */
export interface PlatformState {
  flags: Record<string, boolean>;
  announcements: Announcement[];
  /** Present only while the service is read-only. */
  maintenance: MaintenanceNotice | null;
}

// ---------------------------------------------------------------------------
// Operations console (P3.4, P3.5, P3.6, P3.7)
// ---------------------------------------------------------------------------

export interface FeatureFlagOverride {
  id: string;
  organisation_id: string | null;
  user_id: string | null;
  enabled: boolean;
}

export interface FeatureFlag {
  id: string;
  key: string;
  description: string;
  enabled: boolean;
  rollout_percentage: number;
  /** The kill switch. Outranks every override — see `app/core/flags.py`. */
  killed: boolean;
  overrides: FeatureFlagOverride[];
}

export interface MaintenanceWindow {
  id: string;
  /** The operator's own note. Never shown to a customer. */
  reason: string;
  /** What a user is told. */
  message: string;
  started_at: string;
  ended_at: string | null;
  expected_end_at: string | null;
  allow_staff: boolean;
}

export interface AccountLifecycle {
  user_id: string;
  is_active: boolean;
  suspended_at: string | null;
  suspension_reason: string | null;
  deletion_scheduled_at: string | null;
}

export interface FailureClass {
  reason: string;
  count: number;
}

export interface FleetHealth {
  window_hours: number;
  queue_depth: Record<string, number>;
  jobs_in_window: Record<string, number>;
  /** **null means "no runs to judge", not 0%.** Render the two differently. */
  success_rate: number | null;
  failures: FailureClass[];
  /** How `failures` was grouped. Shown, so a coarse grouping is not read as a
   * classification. */
  failure_grouping: string;
  storage_bytes: number;
  storage_bytes_added_in_window: number;
  live_sessions: number;
  users_total: number;
  users_suspended: number;
  users_awaiting_deletion: number;
  mail_delivers: boolean;
  maintenance_active: boolean;
}

// ---------------------------------------------------------------------------
// Cost honesty (P5.7, over P8.4's meter)
// ---------------------------------------------------------------------------

export interface RunEstimate {
  meter: string;
  unit: string;
  /** `null` when there is too little history. Render the sentence, not a zero. */
  units: number | null;
  basis: "measured" | "unavailable" | string;
  how: string;
  samples: number;
  /** The whole thing as one sentence, already honest. Prefer rendering this. */
  sentence: string;
}

export interface RunEstimates {
  organisation_id: string;
  estimates: RunEstimate[];
}

// ---------------------------------------------------------------------------
// Approval gates (P5.5)
// ---------------------------------------------------------------------------

/**
 * Four states, and `expired` is not a fourth way of saying no.
 *
 * An expired gate was never decided — nobody looked, or nobody with standing
 * looked in time. Rendering it as a rejection would show a refusal that nobody
 * made, which is the same class of error as showing an approval nobody gave.
 */
export type GateState = "pending" | "approved" | "rejected" | "expired";

export interface GateRead {
  id: string;
  title: string;
  question: string;
  state: GateState;
  subject_type: string;
  subject_id: string;
  /**
   * The digest of what the reviewer was shown, taken when the gate was raised.
   * Deciding sends the subject as it stands *now* and the backend compares —
   * so an approval cannot land on something that moved while it was pending.
   */
  subject_digest: string;
  /** The spec diff, the assertions it reaches, the cost estimate. */
  evidence: Record<string, unknown>;
  project_id: string | null;
  conversation_id: string | null;
  requested_by_id: string;
  created_at: string;
  expires_at: string | null;
  decided_at: string | null;
  /** Null on an expiry, and it stays null: nobody decided that one. */
  decided_by_id: string | null;
  decision_note: string | null;
}

export interface GatePage {
  items: GateRead[];
  total: number;
  page: number;
  page_size: number;
}

// ---------------------------------------------------------------------------
// Attachments (P4.1, P4.3, P4.6)
// ---------------------------------------------------------------------------

/**
 * Where the reading of one attachment got to.
 *
 * **`"unsupported"` is not a kind of `"failed"`.** A STEP file attached to a
 * conversation is not a broken upload; it is geometry, and the detail says so
 * and names what to do with it instead. Rendering the two the same way tells
 * somebody their file is corrupt when it is fine.
 */
export type ExtractionStatus = "pending" | "ready" | "unsupported" | "failed";

export interface AttachmentRead {
  id: string;
  conversation_id: string | null;
  project_id: string | null;
  media_id: string;
  /** The user's own text. Never rendered as markup. */
  filename: string;
  detected_kind: string;
  detected_format: string;
  status: ExtractionStatus;
  /** Why, for `unsupported` and `failed`. Server prose naming the next action. */
  status_detail: string | null;
  reader: string;
  reliability: string;
  /**
   * The characters were *inferred* rather than transcribed, so the warning must
   * be shown. Comes from the server rather than being re-derived here: a safety
   * label with two implementations has two standards.
   */
  needs_confirmation: boolean;
  created_at: string;
  extracted_at: string | null;
}

export interface AttachmentPage {
  items: AttachmentRead[];
  total: number;
  page: number;
  page_size: number;
}

export interface ExtractedFragment {
  kind: string;
  text: string;
  /** Where in the file, in the units that file has: page, sheet, cell, layer. */
  where: string;
  cite?: string;
}

export interface AttachmentExtraction {
  attachment_id: string;
  status: ExtractionStatus;
  status_detail: string | null;
  reader: string;
  reliability: string;
  /** The whole sentence, or `null` — never an empty string. */
  unverified_note: string | null;
  notes: string[];
  /** More was read than is stored. Said rather than hidden. */
  truncated: boolean;
  fragment_count: number;
  fragments: ExtractedFragment[];
  /** Seen and deliberately not interpreted. Not errors — the read succeeded. */
  unread: { what: string; why: string }[];
  /**
   * Fragments a reader classified as dimensions. **Candidate numbers and
   * nothing more** — dimension and GD&T extraction is staged as later work, and
   * nothing turns one of these into a design parameter automatically.
   */
  dimensions: ExtractedFragment[];
}

/** How to describe an attachment's state in one word a person can read. */
export function extractionLabel(status: ExtractionStatus): string {
  switch (status) {
    case "pending":
      return "Reading";
    case "ready":
      return "Read";
    case "unsupported":
      // Not "Failed". The file is fine; it is not a document.
      return "Not a document";
    case "failed":
      return "Could not read";
    default:
      return status;
  }
}

// ---------------------------------------------------------------------------
// The design record (P5.3, P5.6)
// ---------------------------------------------------------------------------

/**
 * One named decision the part is built from.
 *
 * `value` and `expression` are mutually exclusive and the backend enforces
 * that: a parameter with an expression is a *consequence* of the others, and
 * giving it a number would leave a formula in the design that no longer
 * describes the value. That is also why the panel refuses to edit one — see
 * `isDerived`.
 */
export interface SpecParameter {
  name: string;
  /** Absent on a derived parameter. */
  value?: number | null;
  /** Absent on a free one. Carries no leading `=`. */
  expression?: string | null;
  /** `"mm"`, `"deg"`, `"kg"`, `"mm2"`, `"mm3"`, or absent for a count/ratio. */
  unit?: string;
  description?: string;
}

/** One element the design creates, and how. */
export interface SpecFeature {
  name: string;
  op: string;
  args?: Record<string, unknown>;
  /** A condition; the feature is skipped when false and stays in the design. */
  when?: string | null;
  /** Why this feature exists — the rationale slot, and the reason it is shown. */
  note?: string;
}

/**
 * `DesignSpec.to_dict()` as the backend emits it.
 *
 * Hand-mirrored like the rest of this file, and `format_version` is the one
 * field that makes the staleness detectable rather than silent: a build reading
 * a version it does not know refuses on the backend before this shape is ever
 * produced.
 */
export interface DesignDocument {
  format_version: number;
  name: string;
  description?: string;
  material?: string | null;
  parameters: SpecParameter[];
  features: SpecFeature[];
}

export interface DesignRead {
  id: string;
  conversation_id: string;
  project_id: string | null;
  name: string;
  /** The identity of this design version. Two specs with this digest are one design. */
  digest: string;
  revision_number: number;
  document: DesignDocument;
  created_at: string;
  updated_at: string;
}

export interface DesignRevision {
  id: string;
  revision_number: number;
  digest: string;
  /** Empty on revision 1 — it changed nothing, it *is* the beginning. */
  summary: string;
  /** `"user"` or `"agent"`. Null `author_id` means the agent, not "unknown". */
  author: string;
  author_id: string | null;
  created_at: string;
}

export interface DesignRevisionPage {
  items: DesignRevision[];
  total: number;
  page: number;
  page_size: number;
}

export interface DesignEdited {
  design: DesignRead;
  /** False when the edit set a parameter to what it already was. */
  changed: boolean;
  /** The `SpecDiff` shape `components/gates/spec-diff.tsx` already renders. */
  diff: Record<string, unknown> | null;
}

/**
 * Can this parameter be edited?
 *
 * A derived parameter is a consequence, and the backend refuses to set one with
 * the formula named. Asking here as well is not a duplicated rule — it is the
 * difference between a disabled field with an explanation and a field that
 * accepts a number and then errors.
 */
export function isDerived(parameter: SpecParameter): boolean {
  return typeof parameter.expression === "string" && parameter.expression.length > 0;
}

// ---------------------------------------------------------------------------
// The docs site and the status page (P10.2, P10.4)
// ---------------------------------------------------------------------------

export interface GuideStep {
  text: string;
  /** Present together or not at all — the backend refuses half a pair. */
  method: string | null;
  path: string | null;
}

export interface Guide {
  slug: string;
  title: string;
  outcome: string;
  steps: GuideStep[];
  /**
   * What this guide deliberately does not cover.
   *
   * Render it. It is the same discipline `Mission.unproven` applies to the
   * ladder, and dropping it turns documentation into marketing — the stop-a-run
   * guide's caveat is that stopping is not a refund, which is the one a reader
   * would otherwise get wrong about their own bill.
   */
  not_covered: string[];
}

export interface MissionEntry {
  rung: string;
  title: string;
  era: string;
  /** The master plan's own "what makes this hard" column. */
  hard: string;
  builds: "part" | "assembly" | "sheet" | "pending";
  buildable: boolean;
  assertions: number;
  /**
   * What this rung does **not** claim. M2's frame is geometry and its welds are
   * not sized, so "M2 passed" must never be readable as "the welds are sized".
   */
  not_claimed: string[];
  /** What a pending rung waits on, each naming the phase that owns it. */
  waiting_on: string[];
}

export interface MissionGallery {
  headline: string;
  missions: MissionEntry[];
}

export interface HandbookIndex {
  guides: { slug: string; title: string; outcome: string }[];
  gallery_headline: string;
  mission_count: number;
  buildable_mission_count: number;
}

export interface ReferenceOperation {
  method: string;
  path: string;
  summary: string;
  tag: string;
  /** Readable with no account. Marked rather than filtered — see the backend. */
  public: boolean;
}

export interface ApiReference {
  title: string;
  version: string;
  operation_count: number;
  public_operation_count: number;
  groups: { tag: string; operations: ReferenceOperation[] }[];
  note: string;
}

/** Three, and no "unknown" — see `app/core/status.py`. */
export type ServiceState = "operational" | "maintenance" | "degraded";

export interface StatusIncident {
  started_at: string;
  ended_at: string | null;
  minutes: number | null;
  message: string;
  /** Said in words rather than left to be inferred from a null end time. */
  ongoing: boolean;
}

export interface ServiceStatus {
  state: ServiceState;
  summary: string;
  notice: string | null;
  announcements: { level: string; message: string }[];
  history: StatusIncident[];
  history_days: number;
}
