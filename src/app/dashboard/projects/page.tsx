import Link from "next/link";

import { FirstRunChecklist } from "@/components/onboarding/first-run";
import { ProjectBrowser } from "@/components/projects/project-browser";
import { ProjectStarters } from "@/components/projects/template-picker";
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

      {/* P10.1. Renders nothing once there is a succeeded run, and needs no
          dismiss button — every tick is derived from what the account actually
          contains, so it cannot be ticked by somebody who has done none of it,
          and it cannot be hidden from somebody who is still stuck. */}
      <FirstRunChecklist />

      <ProjectStarters />

      <ProjectBrowser initial={projects} />
    </PageShell>
  );
}
