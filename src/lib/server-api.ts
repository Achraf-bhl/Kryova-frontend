import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { GeometryPage, PageParams, ProjectPage, SimulationPage } from "@/lib/api-client";
import type { ProjectRead, UserRead } from "@/types/api";

const API_URL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

async function serverFetch<T>(path: string, fallbackError: string): Promise<T> {
  const cookieStore = await cookies();
  const response = await fetch(`${API_URL}${path}`, {
    headers: { cookie: cookieStore.toString() },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/login");
  if (!response.ok) throw new Error(fallbackError);
  return response.json() as Promise<T>;
}

export async function fetchProjectPage(params?: PageParams): Promise<ProjectPage> {
  const search = new URLSearchParams({
    page: String(params?.page ?? 1),
    page_size: String(params?.pageSize ?? 50),
  });
  return serverFetch<ProjectPage>(`/projects?${search}`, "Failed to load projects");
}

export async function fetchCurrentUser(): Promise<UserRead> {
  return serverFetch<UserRead>("/auth/me", "Failed to load current user");
}

export async function fetchProject(projectId: string): Promise<ProjectRead> {
  return serverFetch<ProjectRead>(`/projects/${projectId}`, "Project not found");
}

export async function fetchGeometryVersions(projectId: string): Promise<GeometryPage["items"]> {
  const data = await serverFetch<GeometryPage>(
    `/projects/${projectId}/geometry?page=1&page_size=50`,
    "Failed to load geometry",
  );
  return data.items;
}

export async function fetchSimulations(projectId: string): Promise<SimulationPage["items"]> {
  const data = await serverFetch<SimulationPage>(
    `/projects/${projectId}/simulations?page=1&page_size=50`,
    "Failed to load simulations",
  );
  return data.items;
}
