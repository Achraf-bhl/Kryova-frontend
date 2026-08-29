import { Sidebar } from "./_components/sidebar";

import { ErrorBoundary } from "@/components/error-boundary";
import { fetchConversationsSafe, fetchCurrentUser } from "@/lib/server-api";

export const dynamic = "force-dynamic";

/**
 * The authenticated shell: a persistent sidebar and one scrolling main area.
 *
 * Both halves are fetched here, in parallel, so the sidebar's history is in the
 * first paint rather than arriving after a client round-trip. The list is
 * fetched with the tolerant variant — a chat sidebar that 500s the entire
 * dashboard because one endpoint is unavailable would be a poor trade.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, conversations] = await Promise.all([
    fetchCurrentUser(),
    fetchConversationsSafe(),
  ]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar user={user} initialConversations={conversations} />
      {/* `min-w-0` so a long code block in a chat message cannot widen the flex
          child and push the sidebar off-screen. */}
      <main className="min-w-0 flex-1 overflow-y-auto pt-14 md:pt-0">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </div>
  );
}
