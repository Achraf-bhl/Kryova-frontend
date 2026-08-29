import Link from "next/link";

import { PageShell } from "@/components/ui/page-shell";
import { statusColor } from "@/lib/format";
import { fetchRecentSimulations } from "@/lib/server-api";

export const dynamic = "force-dynamic";

function loadCaseName(loadCase: Record<string, unknown>): string {
  const name = loadCase?.name;
  return typeof name === "string" && name.length > 0 ? name : "Load case";
}

/** Every recent solve, across projects, newest first. */
export default async function RunsPage() {
  const runs = await fetchRecentSimulations();

  return (
    <PageShell className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Runs</h1>
        <p className="mt-1 text-sm text-muted">
          Every simulation across your projects, most recent first.
        </p>
      </div>

      {runs.length === 0 ? (
        <div className="k-panel p-8 text-center">
          <p className="text-sm text-muted">
            Nothing has been solved yet. Ask the agent to clamp a face, hang a load off another,
            and run it.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
          >
            Set up an analysis
          </Link>
        </div>
      ) : (
        <ul className="k-panel divide-y divide-border">
          {runs.map(({ project, item }) => (
            <li key={item.id}>
              <Link
                href={`/dashboard/projects/${project.id}/simulations/${item.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 text-sm hover:bg-primary-soft/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-accent">{loadCaseName(item.load_case)}</span>
                  <span className="block truncate text-xs text-muted">{project.name}</span>
                </span>
                {item.result && (
                  <span className="font-mono text-xs text-muted">
                    {item.result.max_von_mises_mpa.toFixed(1)} MPa
                  </span>
                )}
                <span className={`font-mono text-xs font-medium ${statusColor(item.status)}`}>
                  {item.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
