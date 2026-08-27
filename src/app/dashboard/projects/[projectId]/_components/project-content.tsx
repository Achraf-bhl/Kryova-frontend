"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { CatiaBridgePanel } from "@/components/catia-bridge-panel";
import { api } from "@/lib/api-client";
import { formatBytes, statusColor } from "@/lib/format";
import type { GeometryVersionRead, ProjectRead, SimulationRead } from "@/types/api";

const CHUNKED_THRESHOLD = 16 * 1024 * 1024;
const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;

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
        let version: GeometryVersionRead;
        if (file.size > CHUNKED_THRESHOLD) {
          const session = await api.beginUpload(file.name, file.size, UPLOAD_CHUNK_SIZE);
          for (let index = 0; index < session.total_chunks; index++) {
            const start = index * session.chunk_size;
            const end = Math.min(start + session.chunk_size, file.size);
            await api.uploadChunk(session.id, index, file.slice(start, end));
            setUploadProgress(Math.round(((index + 1) / session.total_chunks) * 100));
          }
          const media = await api.completeUpload(session.id);
          version = await api.attachGeometry(projectId, media.id);
        } else {
          version = await api.uploadGeometry(projectId, file);
        }
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

      <CatiaBridgePanel />

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
    </div>
  );
}
