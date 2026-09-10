import { PageShell } from "@/components/ui/page-shell";

import { OperationsConsole } from "./_components/operations-console";

export const dynamic = "force-dynamic";

/**
 * The operations console (P3.6, P3.5, P3.7).
 *
 * **Under `/dashboard`, not a second web app** — Decision 6. It is the same
 * frontend, the same auth and the same API; what makes it staff-only is that
 * every endpoint behind it answers 404 to a caller without a staff grant, so an
 * ordinary user who guesses the URL sees an empty console rather than a locked
 * door telling them where the console is.
 *
 * There is deliberately no client-side "are you staff" gate deciding whether to
 * render. A route that hides itself in the browser is decoration; the backend
 * is the only guard, and the page is honest about answering nothing when it is
 * not staff asking.
 */
export default async function AdminPage() {
  return (
    <PageShell className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Operations</h1>
        <p className="max-w-prose text-sm text-muted">
          Is Kryova healthy, what is switched on, and what everyone is being told.
        </p>
      </div>
      <OperationsConsole />
    </PageShell>
  );
}
