"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import type { ProjectTemplate } from "@/types/api";

/**
 * Start a project from a rung of the mission ladder, or import one (ROAD_TO_10 7.7, 7.8).
 *
 * **A template's caveats are shown before it is chosen, not after.** Each card lists what the
 * rung claims and what it does NOT prove, the same two lists the project's description will
 * carry: a gallery that printed the passes and dropped the caveats would be the most
 * convincing page in the product and the most misleading. A rung that is an assembly or a
 * mechanism says it starts with no design, because it is a product graph and a conversation
 * holds one design.
 */
export function ProjectStarters() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<ProjectTemplate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function show() {
    setOpen(true);
    if (templates !== null) return;
    try {
      setTemplates(await api.listProjectTemplates());
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not load the templates.");
    }
  }

  async function start(key: string) {
    setBusy(true);
    setFailure(null);
    try {
      const started = await api.createProjectFromTemplate(key);
      router.push(
        started.conversation_id
          ? `/dashboard/c/${started.conversation_id}`
          : `/dashboard/projects/${started.project.id}`,
      );
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not start the project.");
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    setBusy(true);
    setFailure(null);
    try {
      const imported = await api.importProject(file);
      setReport(
        `Imported ${imported.geometry_versions} geometry version(s) and ${imported.designs} design(s). ` +
          `Not restored: ${imported.not_restored.join("; ")}.`,
      );
      router.push(`/dashboard/projects/${imported.project.id}`);
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not import that archive.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void show()} disabled={busy}>
          Start from a mission
        </Button>
        <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
          Import a project
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          aria-label="Project archive"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
          }}
        />
      </div>

      {failure && (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      )}
      {report && <p className="text-sm text-muted">{report}</p>}

      {open && (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Mission templates">
          {(templates ?? []).map((template) => (
            <li key={template.key} className="k-panel flex flex-col gap-2 p-4 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-medium text-accent">
                  {template.key} · {template.title}
                </h3>
                <span className="text-xs text-faint">{template.kind}</span>
              </div>
              <p className="text-muted">{template.hard}</p>
              <details>
                <summary className="cursor-pointer text-xs text-muted">
                  Claims {template.claims.length} · does not prove {template.unproven.length}
                </summary>
                <ul className="mt-2 list-disc pl-5 text-xs text-muted">
                  {template.claims.map((claim) => (
                    <li key={claim}>{claim}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs font-medium text-warning">Does NOT prove</p>
                <ul className="list-disc pl-5 text-xs text-muted">
                  {template.unproven.length === 0 ? (
                    <li>(the rung lists nothing)</li>
                  ) : (
                    template.unproven.map((item) => <li key={item}>{item}</li>)
                  )}
                </ul>
              </details>
              {!template.seeds_a_design && (
                <p className="text-xs text-faint">
                  Starts with no design: it is a product of several parts.
                </p>
              )}
              <Button onClick={() => void start(template.key)} disabled={busy}>
                Start
              </Button>
            </li>
          ))}
          {templates === null && !failure && <li className="text-sm text-muted">Loading…</li>}
        </ul>
      )}
    </div>
  );
}
