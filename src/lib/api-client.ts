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
      headers: (() => {
        const h: Record<string, string> = { "x-requested-with": "kryova" };
        const csrf = getCsrfToken();
        if (csrf) h["x-csrf-token"] = decodeURIComponent(csrf);
        return h;
      })(),
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

async function uploadRequest<T>(path: string, body: FormData | Blob, contentType?: string): Promise<T> {
  const headers = new Headers();
  if (contentType) headers.set("Content-Type", contentType);
  const csrfToken = getCsrfToken();
  if (csrfToken) headers.set("x-csrf-token", decodeURIComponent(csrfToken));

  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body,
    credentials: "include",
  });
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new ApiError(response.status, errorBody.detail ?? `Upload failed with ${response.status}`);
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
  surfaceField: (projectId: string, simulationId: string) =>
    request<SurfaceField>(`/projects/${projectId}/simulations/${simulationId}/surface`),
  surfaceFieldBinary: async (projectId: string, simulationId: string): Promise<SurfaceField> => {
    const buffer = await requestBuffer(`/projects/${projectId}/simulations/${simulationId}/surface/binary`);
    return parseBinarySurfaceField(buffer);
  },

  aiStatus: () => request<AIStatus>("/ai/status"),
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
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new ApiError(response.status, body.detail ?? `Request failed with ${response.status}`);
  }
  return response.arrayBuffer();
}

export function parseBinarySurfaceField(buffer: ArrayBuffer): SurfaceField {
  const dataView = new DataView(buffer);
  const magic = String.fromCharCode(
    dataView.getUint8(0),
    dataView.getUint8(1),
    dataView.getUint8(2),
    dataView.getUint8(3)
  );
  if (magic !== "KRYO") {
    throw new Error("Invalid binary surface field format");
  }

  const numNodes = dataView.getUint32(8, true);
  const numTriangles = dataView.getUint32(12, true);
  const maxVonMisesMpa = dataView.getFloat32(16, true);
  const maxDisplacementMm = dataView.getFloat32(20, true);

  const headerSize = 32;
  const nodesByteLength = numNodes * 3 * 4;
  const triByteLength = numTriangles * 3 * 4;
  const dispByteLength = numNodes * 3 * 4;

  let offset = headerSize;

  const rawNodes = new Float32Array(buffer, offset, numNodes * 3);
  offset += nodesByteLength;

  const rawTriangles = new Uint32Array(buffer, offset, numTriangles * 3);
  offset += triByteLength;

  const rawDisplacements = new Float32Array(buffer, offset, numNodes * 3);
  offset += dispByteLength;

  const rawVonMises = new Float32Array(buffer, offset, numNodes);

  const node_positions: [number, number, number][] = new Array(numNodes);
  for (let i = 0; i < numNodes; i++) {
    node_positions[i] = [rawNodes[i * 3], rawNodes[i * 3 + 1], rawNodes[i * 3 + 2]];
  }

  const triangles: [number, number, number][] = new Array(numTriangles);
  for (let i = 0; i < numTriangles; i++) {
    triangles[i] = [rawTriangles[i * 3], rawTriangles[i * 3 + 1], rawTriangles[i * 3 + 2]];
  }

  const displacements: [number, number, number][] = new Array(numNodes);
  for (let i = 0; i < numNodes; i++) {
    displacements[i] = [
      rawDisplacements[i * 3],
      rawDisplacements[i * 3 + 1],
      rawDisplacements[i * 3 + 2],
    ];
  }

  const von_mises_mpa = Array.from(rawVonMises);

  return {
    node_positions,
    triangles,
    displacements,
    von_mises_mpa,
    max_von_mises_mpa: maxVonMisesMpa,
    max_displacement_mm: maxDisplacementMm,
  };
}


export { ApiError };
