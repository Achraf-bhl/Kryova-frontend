import Link from "next/link";

import { fetchProjectPage } from "@/lib/server-api";

import CreateProjectForm from "./_components/create-project-form";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { items: projects } = await fetchProjectPage();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="mt-1 text-sm text-muted">
          Each project holds geometry versions and simulation runs.
        </p>
      </div>

      <CreateProjectForm />

      {projects.length === 0 ? (
        <p className="rounded-lg bg-surface p-8 text-center text-sm text-muted shadow-card">
          No projects yet. Create one above to get started.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/dashboard/projects/${project.id}`}
                className="block rounded-lg bg-surface p-5 shadow-card transition-shadow hover:shadow-raised"
              >
                <h2 className="font-semibold">{project.name}</h2>
                <p className="mt-1 line-clamp-2 text-sm text-muted">
                  {project.description ?? "No description"}
                </p>
                <time className="mt-3 block text-xs text-muted/70" dateTime={project.updated_at}>
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
    </div>
  );
}
