import { notFound } from "next/navigation";

import { PageShell } from "@/components/ui/page-shell";
import {
  fetchGeometryVersions,
  fetchProject,
  fetchSimulations,
  isNotFound,
} from "@/lib/server-api";

import { ProjectContent } from "./_components/project-content";

export const dynamic = "force-dynamic";

interface ProjectPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;

  let data: Awaited<ReturnType<typeof fetchProject>>;
  let geometry: Awaited<ReturnType<typeof fetchGeometryVersions>>;
  let simulations: Awaited<ReturnType<typeof fetchSimulations>>;

  try {
    [data, geometry, simulations] = await Promise.all([
      fetchProject(projectId),
      fetchGeometryVersions(projectId),
      fetchSimulations(projectId),
    ]);
  } catch (error) {
    // Only a real 404 is a missing project. A 500, a timeout or an unreachable
    // API must reach `dashboard/error.tsx` instead — a bare `catch { notFound() }`
    // told every user their project had been deleted whenever the backend
    // hiccuped, and swallowed the NEXT_REDIRECT that a 401 throws on its way to
    // the login page.
    if (isNotFound(error)) notFound();
    throw error;
  }

  return (
    <PageShell>
      <ProjectContent
        project={data}
        geometryVersions={geometry}
        simulations={simulations}
      />
    </PageShell>
  );
}
