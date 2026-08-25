import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { ProjectPage } from "@/lib/api-client";
import type { UserRead } from "@/types/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export async function fetchProjectPage(): Promise<ProjectPage> {
  const cookieStore = await cookies();
  const response = await fetch(`${API_URL}/projects?page=1&page_size=50`, {
    headers: { cookie: cookieStore.toString() },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/login");
  if (!response.ok) throw new Error("Failed to load projects");
  return response.json() as Promise<ProjectPage>;
}

export async function fetchCurrentUser(): Promise<UserRead> {
  const cookieStore = await cookies();
  const response = await fetch(`${API_URL}/auth/me`, {
    headers: { cookie: cookieStore.toString() },
    cache: "no-store",
  });
  if (!response.ok) redirect("/login");
  return response.json() as Promise<UserRead>;
}
