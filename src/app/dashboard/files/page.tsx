import Link from "next/link";

import { PageShell } from "@/components/ui/page-shell";
import { formatBytes } from "@/lib/format";
import { fetchRecentGeometry } from "@/lib/server-api";

export const dynamic = "force-dynamic";

/** Every geometry version across projects — what the solver actually meshed. */
export default async function FilesPage() {
  const files = await fetchRecentGeometry();

  return (
    <PageShell className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Files</h1>
        <p className="mt-1 text-sm text-muted">
          CAD uploaded or exported from CATIA, newest first. Each row is one geometry version.
        </p>
      </div>

      {files.length === 0 ? (
        <div className="k-panel p-8 text-center">
          <p className="text-sm text-muted">
            No geometry yet. Build a part in CATIA from a chat, or open a project and upload a
            STEP file.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
          >
            Start a part
          </Link>
        </div>
      ) : (
        <ul className="k-panel divide-y divide-border">
          {files.map(({ project, item }) => (
            <li key={item.id}>
              <Link
                href={`/dashboard/projects/${project.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 text-sm hover:bg-primary-soft/50"
              >
                <span className="font-mono text-xs text-faint">v{item.version_number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-accent">{item.filename}</span>
                  <span className="block truncate text-xs text-muted">{project.name}</span>
                </span>
                <span className="font-mono text-xs text-muted">{formatBytes(item.size_bytes)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
