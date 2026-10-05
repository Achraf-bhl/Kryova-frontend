"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { parseTagInput } from "@/lib/activity-feed";
import type { ProjectRead } from "@/types/api";

/**
 * The top of a project page: its name, tags and the whole-project verbs
 * (ROAD_TO_10 7.1, 7.2, 7.6, 7.8).
 *
 * **Every verb waits for the server and shows its refusal as words.** Rename on the spot
 * (the first chat names a project "New project" and later renames it from the
 * conversation's title; either can be overridden here). **Archive hides, it does not
 * delete** — the button says so. **Duplicate reports what the copy left out**, because
 * "did it copy my runs" is the question and the answer is no. Export downloads the zip the
 * server builds; the browser never assembles it.
 */
export interface ProjectHeaderProps {
  project: ProjectRead;
}

export function ProjectHeader({ project: initial }: ProjectHeaderProps) {
  const router = useRouter();
  const [project, setProject] = useState(initial);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(initial.name);
  const [tagText, setTagText] = useState(initial.tags.join(", "));
  const [editingTags, setEditingTags] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run<T>(action: () => Promise<T>, done: (value: T) => void) {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    try {
      done(await action());
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const rename = () =>
    run(
      () => api.updateProject(project.id, { name: name.trim() }),
      (updated) => {
        setProject(updated);
        setEditingName(false);
        router.refresh();
      },
    );

  const saveTags = () =>
    run(
      () => api.updateProject(project.id, { tags: parseTagInput(tagText) }),
      (updated) => {
        setProject(updated);
        setTagText(updated.tags.join(", "));
        setEditingTags(false);
      },
    );

  const toggleArchive = () =>
    run(
      () => api.updateProject(project.id, { archived: project.archived_at === null }),
      (updated) => setProject(updated),
    );

  const toggleStar = () =>
    run(
      () => api.starProject(project.id, !project.starred),
      (updated) => setProject(updated),
    );

  const duplicate = () =>
    run(
      () => api.duplicateProject(project.id),
      (copied) => {
        setNotice(
          `Copied ${copied.geometry_versions} geometry version(s) and ${copied.designs} design(s). ` +
            `Not copied: ${copied.left_out.join("; ")}.`,
        );
        router.push(`/dashboard/projects/${copied.project.id}`);
      },
    );

  const exportZip = () =>
    run(
      () => api.exportProjectBlob(project.id),
      (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${project.name.replace(/[^A-Za-z0-9._-]+/g, "-") || "project"}.kryova.zip`;
        link.click();
        URL.revokeObjectURL(url);
      },
    );

  return (
    <header className="flex flex-col gap-3">
      <Link href="/dashboard/projects" className="text-sm text-muted hover:text-accent">
        ← All projects
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editingName ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim()) void rename();
              }}
            >
              <input
                aria-label="Project name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={255}
                autoFocus
                className="h-10 min-w-64 flex-1 rounded-md border border-border bg-surface px-3 text-xl font-semibold outline-none focus:border-primary"
              />
              <Button type="submit" loading={busy}>
                Save
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setName(project.name);
                  setEditingName(false);
                }}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <span className="truncate">{project.name}</span>
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="text-sm font-normal text-muted hover:text-accent"
              >
                Rename
              </button>
            </h1>
          )}
          {project.archived_at && (
            <p className="mt-1 text-sm text-warning">
              Archived on {new Date(project.archived_at).toLocaleDateString()}. Nothing in it was
              deleted.
            </p>
          )}
          {project.description && (
            <p className="mt-1 max-w-2xl whitespace-pre-line text-sm text-muted">
              {project.description}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void toggleStar()} disabled={busy}>
            {project.starred ? "Unstar" : "Star"}
          </Button>
          <Button variant="secondary" onClick={() => void duplicate()} disabled={busy}>
            Duplicate
          </Button>
          <Button variant="secondary" onClick={() => void exportZip()} disabled={busy}>
            Export
          </Button>
          <Button variant="secondary" onClick={() => void toggleArchive()} disabled={busy}>
            {project.archived_at ? "Restore" : "Archive"}
          </Button>
        </div>
      </div>

      <div className="text-sm">
        {editingTags ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void saveTags();
            }}
          >
            <input
              aria-label="Tags, separated by commas"
              value={tagText}
              onChange={(event) => setTagText(event.target.value)}
              placeholder="press, frame, rev b"
              className="h-9 min-w-64 flex-1 rounded-md border border-border bg-surface px-3 outline-none focus:border-primary"
            />
            <Button type="submit" loading={busy}>
              Save tags
            </Button>
          </form>
        ) : (
          <p className="text-muted">
            {project.tags.length > 0 ? project.tags.join(" · ") : "No tags"}{" "}
            <button
              type="button"
              onClick={() => setEditingTags(true)}
              className="ml-1 hover:text-accent"
            >
              Edit tags
            </button>
          </p>
        )}
      </div>

      {notice && <p className="text-sm text-muted">{notice}</p>}
      {failure && (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      )}
    </header>
  );
}
