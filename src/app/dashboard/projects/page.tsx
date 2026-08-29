import Link from "next/link";

import { PageShell } from "@/components/ui/page-shell";
import { fetchProjectPage } from "@/lib/server-api";

export const dynamic = "force-dynamic";

/**
 * The project list — the old `/dashboard`, unchanged in function and now one
 * click away in the sidebar rather than the front door.
 */
export default async function ProjectsPage() {
  const { items: projects } = await fetchProjectPage();

  return (
    <PageShell className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-muted">
            Each project holds geometry versions and simulation runs.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
        >
          New chat
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="k-panel p-8 text-center">
          <p className="text-sm text-muted">
            No projects yet. Describe the part you want to build and the agent creates one for
            you — geometry, loads and material included.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
          >
            Start a chat
          </Link>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/dashboard/projects/${project.id}`}
                className="k-panel block p-5 transition-shadow hover:shadow-raised"
              >
                <h2 className="font-medium text-accent">{project.name}</h2>
                <p className="mt-1 line-clamp-2 text-sm text-muted">
                  {project.description ?? "No description"}
                </p>
                <time className="mt-3 block font-mono text-xs text-faint" dateTime={project.updated_at}>
                  Updated{" "}
                  {new Date(project.updated_at).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
