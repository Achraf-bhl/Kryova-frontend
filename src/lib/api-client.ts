import { parseBinarySurfaceField, surfaceFieldFromJson } from "@/lib/surface-field";
import type { SurfaceFieldArrays } from "@/lib/surface-field";
import type {
  AIStatus,
  GeometryVersionRead,
  Material,
  ProjectCreate,
  ProjectRead,
  ResultInterpretation,
  SimulationCreate,
  SimulationRead,
  SurfaceField,
  UserRead,
} from "@/types/api";
import type { CatiaDevice, CatiaDeviceCreated, CatiaStatus } from "@/types/catia";
import type { ConversationDetail, ConversationPage } from "@/types/conversation";

export type Session = { user: UserRead; csrf_token: string };
export type ProjectPage = {
  total: number;
  page: number;
  page_size: number;
  items: ProjectRead[];
};

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
async function fetchWithRefresh(path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${BASE_URL}${path}`, init);
  if (response.status !== 401 || path === REFRESH_PATH) return response;
  if (!(await refreshSession())) return response;
  return fetch(`${BASE_URL}${path}`, init);
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

  login: async (email: string, password: string): Promise<Session> => {
    const form = new URLSearchParams({ username: email, password });
    return request<Session>("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  },

  me: () => request<UserRead>("/auth/me"),

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

export { ApiError };
export { parseBinarySurfaceField, surfaceFieldFromJson } from "@/lib/surface-field";
export type { SurfaceFieldArrays } from "@/lib/surface-field";
