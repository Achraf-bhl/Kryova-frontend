import { parseBinarySurfaceField, surfaceFieldFromJson } from "@/lib/surface-field";
import type { SurfaceFieldArrays } from "@/lib/surface-field";
import type {
  AIStatus,
  DeviceSession,
  DomainRole,
  Invitation,
  InvitationIssued,
  Member,
  Announcement,
  OrganisationMembership,
  OrgRole,
  ProjectTransfer,
  RunEstimates,
  ShareLink,
  ShareLinkIssued,
  SharedPackage,
  GeometryVersionRead,
  LoginResult,
  Material,
  MfaEnrolment,
  AccountLifecycle,
  AnnouncementLevel,
  AttachmentExtraction,
  AttachmentPage,
  AttachmentRead,
  DesignEdited,
  DesignRead,
  DesignRevisionPage,
  FeatureFlag,
  ApiReference,
  FleetHealth,
  GatePage,
  GateRead,
  GateState,
  Guide,
  HandbookIndex,
  MissionGallery,
  ServiceStatus,
  MaintenanceWindow,
  MfaStatus,
  PlatformState,
  ProjectCreate,
  ProjectRead,
  ResultInterpretation,
  SimulationCreate,
  SimulationRead,
  SurfaceField,
  UserRead,
  VerificationStatus,
} from "@/types/api";
import type { CatiaDevice, CatiaDeviceCreated, CatiaStatus } from "@/types/catia";
import type { ConversationDetail, ConversationPage } from "@/types/conversation";

export type Session = { user: UserRead; csrf_token: string };

/**
 * One page of anything, matching `app/schemas/pagination.py::Page`.
 *
 * Added with P2.6 rather than declaring a fourth hand-written `XPage` alias —
 * every list endpoint here paginates by rule (`page_size` capped at 100), so
 * the shape is the same every time and a per-resource copy is three chances to
 * misspell `page_size`.
 */
export type Page<T> = {
  total: number;
  page: number;
  page_size: number;
  items: T[];
};

export type ProjectPage = Page<ProjectRead>;

export interface PageParams {
  page?: number;
  pageSize?: number;
}

function toQuery(params?: PageParams): string {
  const search = new URLSearchParams();
  if (params?.page != null) search.set("page", String(params.page));
  if (params?.pageSize != null) search.set("page_size", String(params.pageSize));
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}
export type GeometryPage = {
  total: number;
  page: number;
  page_size: number;
  items: GeometryVersionRead[];
};
export type SimulationPage = {
  total: number;
  page: number;
  page_size: number;
  items: SimulationRead[];
};

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

/**
 * The same base URL, for the two streaming clients.
 *
 * SSE cannot go through `request()` — `lib/agent-stream.ts` reads a POST body
 * with a streaming reader, `lib/catia-events.ts` uses `EventSource` — but the
 * origin must not be spelled a third time: a base URL that disagrees with this
 * one is also a `connect-src` the CSP in `src/proxy.ts` does not allow, and the
 * only symptom is a console violation.
 */
export const API_BASE_URL = BASE_URL;

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)kryova_csrf=([^;]+)/);
  return match?.[1] ?? null;
}

const REFRESH_PATH = "/auth/refresh";

/**
 * The one refresh currently in flight, if any.
 *
 * The backend rotates refresh tokens: presenting one invalidates it and issues
 * a replacement. So two 401s racing (a `Promise.all` on a page load, or a
 * chunked upload alongside a poll) must NOT each post `/auth/refresh` — the
 * second would present a token the first already burned, get a 401, and log the
 * user out through nothing but a timing accident. Every concurrent 401 awaits
 * this single promise instead.
 */
let inFlightRefresh: Promise<boolean> | null = null;

async function postRefresh(): Promise<boolean> {
  const headers = new Headers({ "x-requested-with": "kryova" });
  const csrf = getCsrfToken();
  if (csrf) headers.set("x-csrf-token", decodeURIComponent(csrf));
  try {
    const response = await fetch(`${BASE_URL}${REFRESH_PATH}`, {
      method: "POST",
      credentials: "include",
      headers,
    });
    return response.ok;
  } catch {
    // A network failure is not an auth failure; the caller surfaces the
    // original 401 rather than pretending the session was renewed.
    return false;
  }
}

/** Refresh the session, coalescing concurrent callers onto one request. */
function refreshSession(): Promise<boolean> {
  inFlightRefresh ??= postRefresh().finally(() => {
    inFlightRefresh = null;
  });
  return inFlightRefresh;
}

/** Exposed for tests: drop any memoised refresh between cases. */
export function __resetRefreshState(): void {
  inFlightRefresh = null;
}

/**
 * `fetch` plus the single-flight 401 retry, shared by every transport in this
 * module (JSON, uploads, binary). An access token expiring mid-upload has to be
 * survivable, so the retry cannot live in the JSON path alone.
 *
 * `init` is replayed verbatim on retry. That is safe for the body types used
 * here (string, `URLSearchParams`, `Blob`, `FormData` — all re-readable); a
 * `ReadableStream` body would be consumed by the first attempt, so don't
 * introduce one without buffering it first.
 */
export async function fetchWithRefresh(path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${BASE_URL}${path}`, init);
  if (response.status !== 401 || path === REFRESH_PATH) return response;
  if (!(await refreshSession())) return response;
  return fetch(`${BASE_URL}${path}`, withFreshCsrf(init));
}

/**
 * Replace a stale CSRF header with the one the refresh just issued.
 *
 * `/auth/refresh` rotates `kryova_csrf` along with the session, so replaying a
 * mutation *verbatim* sends the token from before the refresh against the
 * cookie from after it. The backend compares the two and answers 403 "CSRF
 * failure" — turning a recoverable expiry into a hard error, which is the exact
 * thing the retry exists to prevent.
 *
 * Only touched when the caller set the header: a GET has none, and adding one
 * would be inventing a credential it never sent.
 */
function withFreshCsrf(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  if (!headers.has("x-csrf-token")) return init;
  const token = getCsrfToken();
  if (token) headers.set("x-csrf-token", decodeURIComponent(token));
  return { ...init, headers };
}

async function failFromResponse(response: Response, fallback: string): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as { detail?: string };
  throw new ApiError(response.status, body.detail ?? fallback);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("x-requested-with", "kryova");

  const response = await fetchWithRefresh(path, {
    ...init,
    headers,
    credentials: "include",
  });

  if (!response.ok) {
    await failFromResponse(response, `Request failed with ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function mutatingRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const csrfToken = getCsrfToken();
  const headers = new Headers(init?.headers);
  if (csrfToken) headers.set("x-csrf-token", decodeURIComponent(csrfToken));
  return request<T>(path, { ...init, headers });
}

async function uploadRequest<T>(path: string, body: FormData | Blob, contentType?: string): Promise<T> {
  const headers = new Headers({ "x-requested-with": "kryova" });
  if (contentType) headers.set("Content-Type", contentType);
  const csrfToken = getCsrfToken();
  if (csrfToken) headers.set("x-csrf-token", decodeURIComponent(csrfToken));

  const response = await fetchWithRefresh(path, {
    method: "POST",
    headers,
    body,
    credentials: "include",
  });
  if (!response.ok) {
    await failFromResponse(response, `Upload failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  beginUpload: (filename: string, totalSize: number, chunkSize?: number) =>
    mutatingRequest<{ id: string; chunk_size: number; total_chunks: number }>("/media/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename,
        total_size_bytes: totalSize,
        kind: "cad",
        ...(chunkSize ? { chunk_size: chunkSize } : {}),
      }),
    }),

  uploadChunk: async (uploadId: string, index: number, data: Blob): Promise<void> => {
    await uploadRequest<void>(`/media/uploads/${uploadId}/chunks/${index}`, data, "application/octet-stream");
  },

  completeUpload: (uploadId: string) =>
    request<{ id: string; filename: string; size_bytes: number }>(
      `/media/uploads/${uploadId}/complete`,
      { method: "POST" },
    ),

  attachGeometry: async (projectId: string, mediaId: string, note?: string) => {
    const form = new FormData();
    form.append("media_id", mediaId);
    if (note) form.append("note", note);
    return uploadRequest<GeometryVersionRead>(`/projects/${projectId}/geometry/attach`, form);
  },

  register: (email: string, password: string, fullName: string) =>
    request<UserRead>("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, full_name: fullName || null }),
    }),

  /**
   * Sign in. Returns a session, **or** a challenge when the account has a
   * second factor (P1.7) — narrow with `isMfaChallenge` before reading `user`.
   */
  login: async (email: string, password: string): Promise<LoginResult> => {
    const form = new URLSearchParams({ username: email, password });
    return request<LoginResult>("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  },

  /** Finish a sign-in with a TOTP code or a recovery code. One field: the
   * server tells them apart, so the user does not have to classify what they
   * are holding before they can type it. */
  completeMfaLogin: (challengeToken: string, code: string) =>
    request<Session>("/auth/login/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge_token: challengeToken, code }),
    }),

  me: () => request<UserRead>("/auth/me"),

  /** Flags, banners and the maintenance notice (P3.5, P3.7). Readable signed
   * out, and deliberately readable *during* maintenance — it is the endpoint
   * that explains the window. */
  platformState: () => request<PlatformState>("/platform/state"),

  // --- The docs site and the status page (P10.2, P10.4) --------------------
  // All five are readable with no account, on purpose: documentation behind a
  // login can only be read by people who already bought, and a status page only
  // its operator can read is a private dashboard.

  handbook: () => request<HandbookIndex>("/handbook"),
  listGuides: () => request<{ guides: Guide[] }>("/handbook/guides"),
  readGuide: (slug: string) => request<Guide>(`/handbook/guides/${slug}`),
  /** Every ladder rung, derived from the suite rather than typed up beside it. */
  missionGallery: () => request<MissionGallery>("/handbook/gallery"),
  /** Built from this deployment's own OpenAPI document. */
  apiReference: () => request<ApiReference>("/handbook/reference"),
  /** Is Kryova working, and what happened recently. Carries no fleet numbers. */
  serviceStatus: () => request<ServiceStatus>("/status"),

  // --- Attachments (P4.1, P4.3, P4.6) --------------------------------------

  /**
   * Hand an already-uploaded blob to a conversation, and read it.
   *
   * Two steps on purpose: the bytes go up through the chunked-upload path,
   * which is resumable and content-addressed, and this says what they are for.
   * Answers `201` whatever the reading produced — an unsupported format is a
   * recorded outcome, not a failed request, because refusing would lose the
   * fact that the user handed us something.
   */
  createAttachment: (body: {
    media_id: string;
    conversation_id?: string | null;
    project_id?: string | null;
    filename?: string;
  }) =>
    mutatingRequest<AttachmentRead>("/attachments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  /**
   * This conversation's attachments, newest first.
   *
   * Deliberately complete: the ones that could not be read are in it. A panel
   * that omitted the STEP file somebody dropped in would leave them wondering
   * whether it uploaded at all.
   */
  listAttachments: (conversationId?: string | null) => {
    const suffix = conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : "";
    return request<AttachmentPage>(`/attachments${suffix}`);
  },

  /**
   * What was read out of one file, with a citation on every fragment.
   *
   * Not the file — the media routes own downloading that. The "unverified
   * read" warning is part of *this* response rather than something the client
   * decides to add: a wrongly read tolerance is worse than an unread one, so
   * the label travels with the content.
   */
  readExtraction: (attachmentId: string) =>
    request<AttachmentExtraction>(`/attachments/${attachmentId}/content`),

  deleteAttachment: (attachmentId: string) =>
    mutatingRequest<void>(`/attachments/${attachmentId}`, { method: "DELETE" }),

  // --- The design record (P5.3, P5.6) --------------------------------------

  /**
   * The specification for one conversation, spec inline.
   *
   * Addressed by conversation rather than by a design id, which is not an
   * accident of URL design: ownership is `conversation.owner_id`, one check in
   * one place, and an id-addressed route would need a second check that could
   * disagree with it. Answers `404` before the agent has written one down.
   */
  readDesign: (conversationId: string) => request<DesignRead>(`/designs/${conversationId}`),

  /** The design's history, newest first — what changed and who changed it. */
  listDesignRevisions: (conversationId: string, page = 1) =>
    request<DesignRevisionPage>(`/designs/${conversationId}/revisions?page=${page}`),

  /**
   * Change one number in the design (P5.6's "edit a parameter mid-mission").
   *
   * There is deliberately no way to send a whole spec: a client-authored design
   * is one the server never compiled, and the first malformed one would arrive
   * as a compile error against a revision already written. A *derived*
   * parameter comes back `422` carrying the formula it is derived from — the
   * panel disables those fields, so reaching this is a bug rather than a user
   * error, and the message is the one worth showing when it happens.
   */
  setDesignParameter: (conversationId: string, name: string, value: number) =>
    mutatingRequest<DesignEdited>(
      `/designs/${conversationId}/parameters/${encodeURIComponent(name)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      },
    ),

  // --- Approval gates (P5.5) -----------------------------------------------

  /** Gates in an organisation, newest first. */
  listGates: (
    organisationId: string,
    query: { state?: GateState; conversation_id?: string; page?: number } = {},
  ) => {
    const params = new URLSearchParams();
    if (query.state) params.set("state", query.state);
    if (query.conversation_id) params.set("conversation_id", query.conversation_id);
    if (query.page) params.set("page", String(query.page));
    const suffix = params.toString() ? `?${params}` : "";
    return request<GatePage>(`/organisations/${organisationId}/gates${suffix}`);
  },

  readGate: (organisationId: string, gateId: string) =>
    request<GateRead>(`/organisations/${organisationId}/gates/${gateId}`),

  /**
   * Approve or reject a gate.
   *
   * `subject` is the thing **as it stands now**, not the digest the gate
   * carries. The backend re-digests it and refuses with a `409` if it has
   * moved — passing the stored digest back would make that check a tautology,
   * and an approval that tracked "whatever the design became" is not a
   * sign-off. A rejection without a `note` is refused: what happens next
   * depends entirely on why.
   */
  decideGate: (
    organisationId: string,
    gateId: string,
    body: { approve: boolean; subject: unknown; note?: string },
  ) =>
    mutatingRequest<GateRead>(`/organisations/${organisationId}/gates/${gateId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  /**
   * Ask the turn streaming for this conversation to stop (P5.6).
   *
   * **This is the half that actually stops anything.** Aborting the fetch ends
   * the *stream*, and the agent on the other side carries on driving a CATIA
   * seat — the hook's own abort handler has said so in a comment since it was
   * written. The turn ends at its next step boundary and reports itself over
   * the stream, so the caller should keep listening rather than abort.
   */
  cancelTurn: (conversationId: string) =>
    mutatingRequest<{ status: string; detail: string }>(
      `/ai/conversations/${conversationId}/cancel`,
      { method: "POST" },
    ),

  /**
   * Stop a simulation (P5.6). The response carries the run's **actual** status,
   * which is `cancelled` for a queued job and still `running` for one already
   * inside CalculiX — that one stops at its next stage boundary, and the time
   * it has already used is billed. Render what comes back, not what was asked.
   */
  cancelSimulation: (projectId: string, simulationId: string) =>
    mutatingRequest<SimulationRead>(
      `/projects/${projectId}/simulations/${simulationId}/cancel`,
      { method: "POST" },
    ),

  /** What a run is likely to cost, from the same meter that bills it (P8.4).
   * An estimate with too little history carries no number — render `sentence`
   * rather than assembling one from the parts. */
  runEstimate: (organisationId: string) =>
    request<RunEstimates>(`/organisations/${organisationId}/billing/estimate`),

  // --- Operations console (P3.4-P3.7) --------------------------------------
  // Every one of these is 404 for a non-staff caller: for an ordinary user the
  // whole /admin tree is simply not there.
  fleetHealth: (hours = 24) => request<FleetHealth>(`/admin/health?hours=${hours}`),
  listFlags: () => request<FeatureFlag[]>("/admin/flags"),
  createFlag: (body: {
    key: string;
    description?: string;
    enabled?: boolean;
    rollout_percentage?: number;
  }) =>
    mutatingRequest<FeatureFlag>("/admin/flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  updateFlag: (
    key: string,
    body: {
      description?: string;
      enabled?: boolean;
      rollout_percentage?: number;
      killed?: boolean;
    },
  ) =>
    mutatingRequest<FeatureFlag>(`/admin/flags/${key}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  readMaintenance: () => request<MaintenanceWindow | null>("/admin/maintenance"),
  startMaintenance: (body: {
    reason: string;
    message: string;
    expected_end_at?: string | null;
    allow_staff?: boolean;
  }) =>
    mutatingRequest<MaintenanceWindow>("/admin/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  endMaintenance: () =>
    mutatingRequest<MaintenanceWindow>("/admin/maintenance", { method: "DELETE" }),
  listAnnouncements: () => request<Announcement[]>("/admin/announcements"),
  publishAnnouncement: (body: {
    message: string;
    level?: AnnouncementLevel;
    ends_at?: string | null;
  }) =>
    mutatingRequest<Announcement>("/admin/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  withdrawAnnouncement: (id: string) =>
    mutatingRequest<Announcement>(`/admin/announcements/${id}`, { method: "DELETE" }),
  suspendUser: (userId: string, reason: string) =>
    mutatingRequest<AccountLifecycle>(`/admin/users/${userId}/suspend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }),
  reinstateUser: (userId: string) =>
    mutatingRequest<AccountLifecycle>(`/admin/users/${userId}/reinstate`, { method: "POST" }),
  scheduleUserDeletion: (userId: string, graceDays = 30, reason?: string) =>
    mutatingRequest<AccountLifecycle>(`/admin/users/${userId}/deletion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grace_days: graceDays, reason: reason ?? null }),
    }),
  cancelUserDeletion: (userId: string) =>
    mutatingRequest<AccountLifecycle>(`/admin/users/${userId}/deletion`, { method: "DELETE" }),

  // --- Devices (P1.3) ------------------------------------------------------
  // The session row is the truth, not the cookie: a device signed out from
  // here disappears everywhere immediately, which is the whole point.
  listDevices: () => request<DeviceSession[]>("/auth/sessions"),
  endDevice: (sessionId: string) =>
    mutatingRequest<void>(`/auth/sessions/${sessionId}`, { method: "DELETE" }),
  signOutEverywhere: () => mutatingRequest<void>("/auth/logout-all", { method: "POST" }),

  // --- Email verification (P1.5) -------------------------------------------
  verificationStatus: () => request<VerificationStatus>("/auth/verify-email"),
  resendVerification: () =>
    mutatingRequest<VerificationStatus>("/auth/verify-email/resend", { method: "POST" }),
  /** Unauthenticated: the link opens in whichever browser the mail client hands
   * it to, which is routinely not the one holding the session. */
  confirmEmail: (token: string) =>
    request<UserRead>("/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }),

  // --- Second factor (P1.7) ------------------------------------------------
  mfaStatus: () => request<MfaStatus>("/auth/mfa"),
  beginMfaEnrolment: () => mutatingRequest<MfaEnrolment>("/auth/mfa", { method: "POST" }),
  confirmMfa: (code: string) =>
    mutatingRequest<MfaStatus>("/auth/mfa/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }),
  regenerateRecoveryCodes: () =>
    mutatingRequest<{ recovery_codes: string[] }>("/auth/mfa/recovery-codes", {
      method: "POST",
    }),
  disableMfa: (code: string) =>
    mutatingRequest<void>("/auth/mfa", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }),

  // --- Organisations, members and invitations (P2.6) -----------------------
  listOrganisations: () =>
    request<Page<OrganisationMembership>>("/organisations?page=1&page_size=100"),
  createOrganisation: (name: string) =>
    mutatingRequest<OrganisationMembership>("/organisations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  /** Every project the *tenant* owns, whoever created it — as opposed to
   * `listProjects`, which answers with what you made. */
  listOrganisationProjects: (organisationId: string, params?: PageParams) =>
    request<ProjectPage>(`/organisations/${organisationId}/projects${toQuery(params)}`),
  listMembers: (organisationId: string) =>
    request<Page<Member>>(`/organisations/${organisationId}/members?page=1&page_size=100`),
  updateMember: (
    organisationId: string,
    userId: string,
    roles: { role?: OrgRole; domain_role?: DomainRole | null },
  ) =>
    mutatingRequest<Member>(`/organisations/${organisationId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(roles),
    }),
  removeMember: (organisationId: string, userId: string) =>
    mutatingRequest<void>(`/organisations/${organisationId}/members/${userId}`, {
      method: "DELETE",
    }),
  listInvitations: (organisationId: string) =>
    request<Page<Invitation>>(
      `/organisations/${organisationId}/invitations?page=1&page_size=100`,
    ),
  createInvitation: (
    organisationId: string,
    email: string,
    role: OrgRole,
    domainRole: DomainRole | null,
  ) =>
    mutatingRequest<InvitationIssued>(`/organisations/${organisationId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role, domain_role: domainRole }),
    }),
  revokeInvitation: (organisationId: string, invitationId: string) =>
    mutatingRequest<void>(`/organisations/${organisationId}/invitations/${invitationId}`, {
      method: "DELETE",
    }),
  acceptInvitation: (token: string) =>
    mutatingRequest<OrganisationMembership>("/organisations/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }),

  // --- Sharing and transfer (P2.5) -----------------------------------------
  listShareLinks: (projectId: string) =>
    request<ShareLink[]>(`/projects/${projectId}/shares`),
  createShareLink: (
    projectId: string,
    body: { label?: string; note?: string; days?: number; allow_geometry_download?: boolean },
  ) =>
    mutatingRequest<ShareLinkIssued>(`/projects/${projectId}/shares`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  revokeShareLink: (projectId: string, shareId: string) =>
    mutatingRequest<void>(`/projects/${projectId}/shares/${shareId}`, { method: "DELETE" }),
  transferProject: (projectId: string, toOrganisationId: string, reason?: string) =>
    mutatingRequest<ProjectTransfer>(`/projects/${projectId}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to_organisation_id: toOrganisationId, reason: reason ?? null }),
    }),
  listTransfers: (projectId: string) =>
    request<ProjectTransfer[]>(`/projects/${projectId}/transfers`),
  /** Unauthenticated by design — the token is the credential. Every failure is
   * a 404 with one message, so do not branch on why. */
  readSharedPackage: (token: string) => request<SharedPackage>(`/share/${token}`),

  listProjects: (page = 1, pageSize = 50) =>
    request<ProjectPage>(`/projects?page=${page}&page_size=${pageSize}`),
  createProject: (payload: ProjectCreate) =>
    mutatingRequest<ProjectRead>("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  readProject: (projectId: string) => request<ProjectRead>(`/projects/${projectId}`),
  deleteProject: (projectId: string) =>
    mutatingRequest<void>(`/projects/${projectId}`, { method: "DELETE" }),

  listGeometry: (projectId: string, params?: PageParams) =>
    request<GeometryPage>(`/projects/${projectId}/geometry${toQuery(params)}`),
  uploadGeometry: async (projectId: string, file: File, note?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (note) form.append("note", note);
    return uploadRequest<GeometryVersionRead>(`/projects/${projectId}/geometry`, form);
  },

  listMaterials: () => request<{ materials: Material[] }>("/materials"),

  createSimulation: (projectId: string, payload: SimulationCreate) =>
    mutatingRequest<SimulationRead>(`/projects/${projectId}/simulations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  listSimulations: (projectId: string, params?: PageParams) =>
    request<SimulationPage>(
      `/projects/${projectId}/simulations${toQuery(params)}`,
    ),
  readSimulation: (projectId: string, simulationId: string) =>
    request<SimulationRead>(`/projects/${projectId}/simulations/${simulationId}`),
  deleteSimulation: (projectId: string, simulationId: string) =>
    mutatingRequest<void>(
      `/projects/${projectId}/simulations/${simulationId}`,
      { method: "DELETE" },
    ),
  surfaceField: async (projectId: string, simulationId: string): Promise<SurfaceFieldArrays> => {
    const field = await request<SurfaceField>(
      `/projects/${projectId}/simulations/${simulationId}/surface`,
    );
    return surfaceFieldFromJson(field);
  },
  surfaceFieldBinary: async (
    projectId: string,
    simulationId: string,
  ): Promise<SurfaceFieldArrays> => {
    const buffer = await requestBuffer(
      `/projects/${projectId}/simulations/${simulationId}/surface/binary`,
    );
    return parseBinarySurfaceField(buffer);
  },

  aiStatus: () => request<AIStatus>("/ai/status"),

  // -- conversations ---------------------------------------------------------
  // The chat is the product's front door, so these are read on nearly every
  // screen. The id always comes from the URL; nothing here holds it in memory.

  listConversations: (page = 1, pageSize = 30) =>
    request<ConversationPage>(`/ai/conversations?page=${page}&page_size=${pageSize}`),
  readConversation: (conversationId: string) =>
    request<ConversationDetail>(`/ai/conversations/${conversationId}`),
  renameConversation: (conversationId: string, title: string) =>
    mutatingRequest<ConversationDetail>(`/ai/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  deleteConversation: (conversationId: string) =>
    mutatingRequest<void>(`/ai/conversations/${conversationId}`, { method: "DELETE" }),

  // -- CATIA bridge ----------------------------------------------------------
  // The browser never reaches the workstation; the backend holds the socket and
  // answers for it. See `types/catia.ts`.

  catiaStatus: (conversationId?: string | null) =>
    request<CatiaStatus>(
      `/catia/status${conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : ""}`,
    ),
  listCatiaDevices: () => request<CatiaDevice[]>("/catia/devices"),
  createCatiaDevice: (name: string) =>
    mutatingRequest<CatiaDeviceCreated>("/catia/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  revokeCatiaDevice: (deviceId: string) =>
    mutatingRequest<void>(`/catia/devices/${deviceId}`, { method: "DELETE" }),

  // -- media -----------------------------------------------------------------

  /**
   * One stored blob, as bytes.
   *
   * This is how a CATIA screenshot reaches the chat, and it goes through the
   * same transport as everything else on purpose. The obvious alternative —
   * `<img src="…/media/{id}/content" crossOrigin="use-credentials">` — was
   * rejected for two reasons: it needs the backend's CORS to keep answering
   * credentialed *image* requests for the exact deploy origin forever, and an
   * `<img>` has no way to notice a 401 and retry through `/auth/refresh`, so
   * every picture in the transcript would break fifteen minutes into a session
   * with nothing but a broken-image icon to say why. Going through
   * `fetchWithRefresh` gets the single-flight refresh retry for free, and the
   * `blob:` URL the caller builds from this is already inside the CSP
   * (`img-src 'self' data: blob:` in `src/proxy.ts`) with no policy change.
   *
   * The caller owns the `Blob`: `URL.createObjectURL` on it leaks until
   * `URL.revokeObjectURL`.
   */
  mediaBlob: (mediaId: string) =>
    requestBlob(`/media/${encodeURIComponent(mediaId)}/content`),

  /**
   * A PNG of the part the open kernel is building for one conversation.
   *
   * The counterpart of `mediaBlob` for `GEOMETRY_BACKEND=occt`, where there is
   * no seat to screenshot and no stored media object: the geometry is in the
   * API process and this endpoint draws it on demand. `requestBlob` for the
   * same reason — the `Content-Type` the server sent is the only honest way to
   * say the bytes really are an image, and `fetchWithRefresh` keeps the picture
   * alive across an access-token expiry.
   *
   * The response carries a strong `ETag` that is the render's own digest, which
   * is not a trick: the backend's rendering is deterministic, so identical
   * geometry really does produce identical bytes. Asking again after a turn that
   * changed nothing costs a 304 and no pixels. Nothing here sets a cache mode —
   * the default already revalidates against `Cache-Control: no-cache`.
   *
   * Returns the headers' answers alongside the bytes rather than only the
   * bytes: `X-Kryova-Blank` is the renderer saying it drew an empty frame, and
   * an empty frame is a valid PNG that looks exactly like a successful render
   * of a part that happens to fall outside this view. Inferring it from the
   * compressed size would be a guess where the server has already measured it.
   * (Both headers are in the backend's `expose_headers`; they were not until
   * this caller existed, so they were being set for nobody.)
   *
   * The caller owns the `Blob` and must revoke the object URL built from it.
   */
  kernelRender: (path: string) => requestRender(path),

  interpretSimulation: (projectId: string, simulationId: string) =>
    mutatingRequest<ResultInterpretation>(
      `/projects/${projectId}/simulations/${simulationId}/interpretation`,
      { method: "POST" },
    ),

  logout: () => mutatingRequest<void>("/auth/logout", { method: "POST" }),
};

async function requestBuffer(path: string, init?: RequestInit): Promise<ArrayBuffer> {
  const headers = new Headers(init?.headers);
  headers.set("x-requested-with", "kryova");
  const response = await fetchWithRefresh(path, {
    ...init,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    await failFromResponse(response, `Request failed with ${response.status}`);
  }
  return response.arrayBuffer();
}

/**
 * A binary response as a `Blob`, keeping the `Content-Type` the backend sent.
 *
 * Separate from `requestBuffer` because the type is the point: an `ArrayBuffer`
 * has thrown it away, and the only honest way to say "this really is an image"
 * is to read it off the response the server actually gave.
 */
async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  const headers = new Headers(init?.headers);
  headers.set("x-requested-with", "kryova");
  const response = await fetchWithRefresh(path, {
    ...init,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    await failFromResponse(response, `Request failed with ${response.status}`);
  }
  return response.blob();
}

/** A drawing of the part, plus what the renderer said about it. */
export interface RenderedPart {
  blob: Blob;
  /**
   * The renderer drew an empty frame — measured by it, not guessed here.
   *
   * `false` when the header is missing, which is the safe direction: an old
   * backend, or a proxy that strips it, then produces a picture with no caption
   * rather than a real part captioned as nothing.
   */
  blank: boolean;
  /** The camera the server actually used, which need not be the one asked for. */
  view: string | null;
}

async function requestRender(path: string, init?: RequestInit): Promise<RenderedPart> {
  const headers = new Headers(init?.headers);
  headers.set("x-requested-with", "kryova");
  const response = await fetchWithRefresh(path, {
    ...init,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    await failFromResponse(response, `Request failed with ${response.status}`);
  }
  return {
    blob: await response.blob(),
    blank: response.headers.get("X-Kryova-Blank") === "1",
    view: response.headers.get("X-Kryova-View"),
  };
}

export { ApiError };
export { parseBinarySurfaceField, surfaceFieldFromJson } from "@/lib/surface-field";
export type { SurfaceFieldArrays } from "@/lib/surface-field";
