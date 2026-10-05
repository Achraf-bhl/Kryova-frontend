"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Pill } from "@/components/ui/pill";
import { PinIcon } from "@/components/ui/icons";
import { ApiError, api } from "@/lib/api-client";
import type { ArchivedFilter, ProjectRead } from "@/types/api";

/**
 * The project list with search, tags, stars and the archive (ROAD_TO_10 7.1, 7.6).
 *
 * Server-rendered first (`initial`), then refetched from the API whenever a filter
 * changes. **A star is the reader's own** — the server returns `starred` for the person
 * asking, and the toggle waits for the server's answer rather than flipping a local
 * flag, so the list never shows a star that was not kept.
 *
 * Archived projects are hidden unless asked for, and the view that asks says so: an
 * empty "Archived" list reads as "nothing is archived", which is the true answer and
 * not a loading state.
 */
export interface ProjectBrowserProps {
  initial: ProjectRead[];
}

const ARCHIVE_LABEL: Record<ArchivedFilter, string> = {
  exclude: "Active",
  include: "All",
  only: "Archived",
};

export function ProjectBrowser({ initial }: ProjectBrowserProps) {
  const [items, setItems] = useState(initial);
  const [text, setText] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [starredOnly, setStarredOnly] = useState(false);
  const [archived, setArchived] = useState<ArchivedFilter>("exclude");
  const [failure, setFailure] = useState<string | null>(null);
  // The server's snapshot is current until a filter is touched; after that every change,
  // including going back to "no filter", is answered by the API, so the list can never show
  // a stale subset.
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) return;
    let cancelled = false;
    // A short pause so typing "gearbox" is one request and not seven.
    const timer = setTimeout(() => {
      api
        .searchProjects({ q: text, tag: tag ?? undefined, starred: starredOnly, archived })
        .then((page) => {
          if (cancelled) return;
          setItems(page.items);
          setFailure(null);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setFailure(error instanceof ApiError ? error.message : "Could not search projects.");
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, tag, starredOnly, archived, touched]);

  const untouched = !touched || (text.trim() === "" && tag === null && !starredOnly && archived === "exclude");
  const view = items;
  const tags = [...new Set(view.flatMap((project) => project.tags))].sort();

  async function toggleStar(project: ProjectRead) {
    try {
      const updated = await api.starProject(project.id, !project.starred);
      setItems((previous) => previous.map((p) => (p.id === updated.id ? updated : p)));
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Could not change the star.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Search projects"
          placeholder="Search name, description or tag"
          value={text}
          onChange={(event) => {
            setTouched(true);
            setText(event.target.value);
          }}
          className="h-9 min-w-56 flex-1 rounded-md border border-border bg-surface px-3 text-sm outline-none focus:border-primary"
        />
        <Pill
          active={starredOnly}
          onClick={() => {
            setTouched(true);
            setStarredOnly((on) => !on);
          }}
        >
          Starred
        </Pill>
        {(Object.keys(ARCHIVE_LABEL) as ArchivedFilter[]).map((option) => (
          <Pill
            key={option}
            active={archived === option}
            onClick={() => {
              setTouched(true);
              setArchived(option);
            }}
          >
            {ARCHIVE_LABEL[option]}
          </Pill>
        ))}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Tags">
          {tags.map((name) => (
            <Pill
              key={name}
              active={tag === name}
              onClick={() => {
                setTouched(true);
                setTag(tag === name ? null : name);
              }}
            >
              {name}
            </Pill>
          ))}
        </div>
      )}

      {failure && <p className="text-sm text-danger">{failure}</p>}

      {view.length === 0 ? (
        <p className="k-panel p-6 text-center text-sm text-muted">
          {untouched
            ? "No projects yet. Describe the part you want to build in a new chat and the agent creates one."
            : archived === "only"
              ? "Nothing is archived."
              : "No project matches."}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {view.map((project) => (
            <li key={project.id} className="relative">
              <Link
                href={`/dashboard/projects/${project.id}`}
                className="k-panel block p-5 transition-shadow hover:shadow-raised"
              >
                <h2 className="pr-8 font-medium text-accent">{project.name}</h2>
                <p className="mt-1 line-clamp-2 text-sm text-muted">
                  {project.description?.split("\n")[0] ?? "No description"}
                </p>
                {project.tags.length > 0 && (
                  <p className="mt-2 text-xs text-faint">{project.tags.join(" · ")}</p>
                )}
                <p className="mt-3 flex gap-3 font-mono text-xs text-faint">
                  <time dateTime={project.updated_at}>
                    Updated {new Date(project.updated_at).toLocaleDateString()}
                  </time>
                  {project.archived_at && <span>Archived</span>}
                  {project.template_key && <span>From {project.template_key}</span>}
                </p>
              </Link>
              <button
                type="button"
                aria-label={project.starred ? `Unstar ${project.name}` : `Star ${project.name}`}
                aria-pressed={project.starred}
                onClick={() => void toggleStar(project)}
                className={`absolute right-3 top-3 rounded p-1 ${
                  project.starred ? "text-primary" : "text-faint hover:text-accent"
                }`}
              >
                <PinIcon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
