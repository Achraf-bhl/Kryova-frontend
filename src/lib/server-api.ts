import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { GeometryPage, PageParams, ProjectPage, SimulationPage } from "@/lib/api-client";
import type { ProjectRead, UserRead } from "@/types/api";
import type { ConversationDetail, ConversationPage, ConversationSummary } from "@/types/conversation";

const API_URL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

/**
 * A non-OK response from the backend, carrying the status.
 *
 * Server Components need to tell "this project does not exist" apart from "the
 * API is down": without the status, the only thing a caller can do is
 * `catch { notFound() }`, which renders a 404 for a 500 and hides real outages.
 * The backend answers 404 (never 403) for another user's resource, so a 404
 * here genuinely means "not found" and nothing else.
 */
export class ServerApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ServerApiError";
    this.status = status;
  }
}

/** True when `error` is a backend 404 and the caller should render `notFound()`. */
export function isNotFound(error: unknown): boolean {
  return error instanceof ServerApiError && error.status === 404;
}

async function serverFetch<T>(path: string, fallbackError: string): Promise<T> {
  const cookieStore = await cookies();
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    });
  } catch {
    // 0 == "never reached the backend". Distinct from any HTTP status so a
    // caller can never mistake an unreachable API for a missing resource.
    throw new ServerApiError(0, `${fallbackError}: the API is unreachable`);
  }
  if (response.status === 401) redirect("/login");
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new ServerApiError(response.status, body.detail ?? fallbackError);
  }
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

export async function fetchConversationPage(params?: PageParams): Promise<ConversationPage> {
  const search = new URLSearchParams({
    page: String(params?.page ?? 1),
    page_size: String(params?.pageSize ?? 30),
  });
  return serverFetch<ConversationPage>(`/ai/conversations?${search}`, "Failed to load conversations");
}

/**
 * The sidebar's conversation list, or an empty list.
 *
 * The sidebar is chrome around every authenticated page, so an API that is
 * still catching up — the conversation endpoints post-date the rest of this
 * router — must not take the whole dashboard down with a 404. Only a
 * `ServerApiError` is absorbed; a `redirect()` thrown by an expired session is
 * a control-flow signal and has to keep propagating.
 */
export async function fetchConversationsSafe(): Promise<ConversationSummary[]> {
  try {
    return (await fetchConversationPage()).items;
  } catch (error) {
    if (error instanceof ServerApiError) return [];
    throw error;
  }
}

export async function fetchConversation(conversationId: string): Promise<ConversationDetail> {
  return serverFetch<ConversationDetail>(
    `/ai/conversations/${conversationId}`,
    "Conversation not found",
  );
}

export async function fetchSimulations(projectId: string): Promise<SimulationPage["items"]> {
  const data = await serverFetch<SimulationPage>(
    `/projects/${projectId}/simulations?page=1&page_size=50`,
    "Failed to load simulations",
  );
  return data.items;
}

/** A row of a cross-project list: the item, plus the project it belongs to. */
export interface WithProject<T> {
  project: ProjectRead;
  item: T;
}

/**
 * Fan out over the user's projects to build one cross-project list.
 *
 * The API is project-scoped — there is no `/simulations` or `/geometry`
 * endpoint that spans projects — so "everything I ran recently" has to be
 * assembled here. It is bounded on both sides: the newest `projectLimit`
 * projects, and a total `limit` after sorting. One project failing yields
 * nothing for that project rather than failing the page: a partial list of runs
 * is useful, an error page is not.
 */
async function fanOut<T extends { created_at: string }>(
  load: (projectId: string) => Promise<T[]>,
  limit: number,
  projectLimit: number,
): Promise<WithProject<T>[]> {
  const { items: projects } = await fetchProjectPage({ page: 1, pageSize: projectLimit });

  const perProject = await Promise.all(
    projects.map(async (project) => {
      try {
        return (await load(project.id)).map((item) => ({ project, item }));
      } catch {
        return [];
      }
    }),
  );

  return perProject
    .flat()
    .sort((a, b) => Date.parse(b.item.created_at) - Date.parse(a.item.created_at))
    .slice(0, limit);
}

export async function fetchRecentSimulations(
  limit = 40,
  projectLimit = 20,
): Promise<WithProject<SimulationPage["items"][number]>[]> {
  return fanOut(fetchSimulations, limit, projectLimit);
}

export async function fetchRecentGeometry(
  limit = 40,
  projectLimit = 20,
): Promise<WithProject<GeometryPage["items"][number]>[]> {
  return fanOut(fetchGeometryVersions, limit, projectLimit);
}
