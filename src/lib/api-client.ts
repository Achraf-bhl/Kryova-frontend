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

export type Session = { user: UserRead; csrf_token: string };
export type ProjectPage = {
  total: number;
  page: number;
  page_size: number;
  items: ProjectRead[];
};
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("x-requested-with", "kryova");

  let response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  if (response.status === 401 && path !== "/auth/refresh") {
    const refreshed = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "x-requested-with": "kryova" },
    });
    if (refreshed.ok) {
      response = await fetch(`${BASE_URL}${path}`, {
        ...init,
        headers,
        credentials: "include",
      });
    }
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new ApiError(response.status, body.detail ?? `Request failed with ${response.status}`);
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

  uploadChunk: async (uploadId: string, index: number, data: Blob) => {
    const csrfToken = getCsrfToken();
    const headers = new Headers({ "Content-Type": "application/octet-stream" });
    if (csrfToken) headers.set("x-csrf-token", decodeURIComponent(csrfToken));
    const response = await fetch(`${BASE_URL}/media/uploads/${uploadId}/chunks/${index}`, {
      method: "PUT",
      headers,
      body: data,
      credentials: "include",
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { detail?: string };
      throw new ApiError(response.status, body.detail ?? `Chunk upload failed with ${response.status}`);
    }
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
    const headers = new Headers();
    const csrfToken = getCsrfToken();
    if (csrfToken) headers.set("x-csrf-token", decodeURIComponent(csrfToken));
    const response = await fetch(`${BASE_URL}/projects/${projectId}/geometry/attach`, {
      method: "POST",
      headers,
      body: form,
      credentials: "include",
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { detail?: string };
      throw new ApiError(response.status, body.detail ?? "Failed to attach geometry");
    }
    return response.json() as Promise<GeometryVersionRead>;
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

  listGeometry: (projectId: string) =>
    request<GeometryPage>(`/projects/${projectId}/geometry?page=1&page_size=100`),
  uploadGeometry: async (projectId: string, file: File, note?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (note) form.append("note", note);
    const headers = new Headers();
    const csrfToken = getCsrfToken();
    if (csrfToken) headers.set("x-csrf-token", decodeURIComponent(csrfToken));
    const response = await fetch(`${BASE_URL}/projects/${projectId}/geometry`, {
      method: "POST",
      headers,
      body: form,
      credentials: "include",
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { detail?: string };
      throw new ApiError(response.status, body.detail ?? "Upload failed");
    }
    return response.json() as Promise<GeometryVersionRead>;
  },

  listMaterials: () => request<{ materials: Material[] }>("/materials"),

  createSimulation: (projectId: string, payload: SimulationCreate) =>
    mutatingRequest<SimulationRead>(`/projects/${projectId}/simulations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  listSimulations: (projectId: string) =>
    request<SimulationPage>(
      `/projects/${projectId}/simulations?page=1&page_size=100`,
    ),
  readSimulation: (projectId: string, simulationId: string) =>
    request<SimulationRead>(`/projects/${projectId}/simulations/${simulationId}`),
  deleteSimulation: (projectId: string, simulationId: string) =>
    mutatingRequest<void>(
      `/projects/${projectId}/simulations/${simulationId}`,
      { method: "DELETE" },
    ),
  surfaceField: (projectId: string, simulationId: string) =>
    request<SurfaceField>(`/projects/${projectId}/simulations/${simulationId}/surface`),

  aiStatus: () => request<AIStatus>("/ai/status"),
  interpretSimulation: (projectId: string, simulationId: string) =>
    mutatingRequest<ResultInterpretation>(
      `/projects/${projectId}/simulations/${simulationId}/interpretation`,
      { method: "POST" },
    ),

  logout: () => mutatingRequest<void>("/auth/logout", { method: "POST" }),
};

export { ApiError };
