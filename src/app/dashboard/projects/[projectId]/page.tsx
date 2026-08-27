import { notFound } from "next/navigation";

import {
  fetchGeometryVersions,
  fetchProject,
  fetchSimulations,
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
  } catch {
    notFound();
  }

  return (
    <ProjectContent
      project={data}
      geometryVersions={geometry}
      simulations={simulations}
    />
  );
}
