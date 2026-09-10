import { PageShell } from "@/components/ui/page-shell";
import { OrganisationManager } from "./_components/organisation-manager";

export const dynamic = "force-dynamic";

/**
 * Teams: who is in them, what they may do, and who has been invited (P2.6).
 *
 * A Server Component shell around one client widget, which is the pattern every
 * `dashboard/*` page here follows. The widget is interactive throughout —
 * switching organisation re-fetches members and invitations — so there is
 * nothing worth rendering on the server beyond the heading.
 */
export default async function OrganisationsPage() {
  return (
    <PageShell className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Teams</h1>
        <p className="max-w-prose text-sm text-muted">
          A team owns projects, not a person. Everyone starts with a personal team of their
          own; create another to share a machine programme with colleagues.
        </p>
      </div>
      <OrganisationManager />
    </PageShell>
  );
}
