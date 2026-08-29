"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { CatiaBridgePanel } from "@/components/catia-bridge-panel";
import { uploadGeometryFile } from "@/lib/chunked-upload";
import { formatBytes, statusColor } from "@/lib/format";
import type { GeometryVersionRead, ProjectRead, SimulationRead } from "@/types/api";

function getLoadCaseName(simulation: SimulationRead): string {
  if (simulation.load_case && typeof simulation.load_case === "object" && "name" in simulation.load_case) {
    const name = (simulation.load_case as Record<string, unknown>).name;
    if (typeof name === "string" && name.length > 0) return name;
  }
  return "Load case";
}

export interface ProjectContentProps {
  project: ProjectRead;
  geometryVersions: GeometryVersionRead[];
  simulations: SimulationRead[];
}

export function ProjectContent({ project, geometryVersions: initialGeometry, simulations }: ProjectContentProps) {
  const projectId = project.id;
  const [geometryVersions, setGeometryVersions] = useState(initialGeometry);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setError(null);
      try {
        const version = await uploadGeometryFile(projectId, file, {
          onProgress: setUploadProgress,
        });
        setGeometryVersions((previous) => [version, ...previous]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
        setUploadProgress(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [projectId],
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/dashboard" className="text-sm text-muted hover:text-accent">
            ← All projects
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{project.name}</h1>
          {project.description && (
            <p className="mt-1 max-w-xl text-sm text-muted">{project.description}</p>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* Geometry */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Geometry</h2>
        <div className="rounded-lg bg-surface shadow-card">
          <label className="flex cursor-pointer items-center justify-between gap-4 border-b border-border p-5 transition-colors hover:bg-canvas/60">
            <div>
              <p className="font-medium">
                {uploading
                  ? uploadProgress !== null
                    ? `Uploading… ${uploadProgress}%`
                    : "Uploading…"
                  : "Upload CAD file"}
              </p>
              <p className="mt-0.5 text-sm text-muted">STEP (.stp), IGES (.igs), or STL</p>
            </div>
            <span className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-medium shadow-card">
              Choose file
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".step,.stp,.iges,.igs,.stl"
              className="sr-only"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
          </label>
          {geometryVersions.length > 0 ? (
            <ul>
              {geometryVersions.map((version) => (
                <li key={version.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span>
                    <span className="inline-block w-8 font-mono text-xs text-muted">
                      v{version.version_number}
                    </span>
                    {version.filename}
                  </span>
                  <span className="text-xs text-muted">
                    {formatBytes(version.size_bytes)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-sm text-muted">No geometry uploaded yet.</p>
          )}
        </div>
      </section>

      {/* Simulations */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Simulations</h2>
          <Link href={`/dashboard/projects/${projectId}/simulate`}>
            <Button>New simulation</Button>
          </Link>
        </div>
        {simulations.length === 0 ? (
          <p className="mt-3 rounded-lg bg-surface p-6 text-center text-sm text-muted shadow-card">
            No simulations yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg bg-surface shadow-card">
            {simulations.map((simulation) => (
              <li key={simulation.id}>
                <Link
                  href={`/dashboard/projects/${projectId}/simulations/${simulation.id}`}
                  className="flex items-center justify-between px-5 py-4 text-sm hover:bg-canvas/50"
                >
                  <span>{getLoadCaseName(simulation)}</span>
                  <span className={`font-medium ${statusColor(simulation.status)}`}>
                    {simulation.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Moved out of the top slot: whether a workstation is connected matters
          when you are about to ask for geometry, not above a list of files. The
          live signal lives in the composer chip now; this is the fuller read. */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">CATIA</h2>
        <CatiaBridgePanel />
      </section>
    </div>
  );
}
