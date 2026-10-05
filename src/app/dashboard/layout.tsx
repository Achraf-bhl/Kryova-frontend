import { Sidebar } from "./_components/sidebar";

import { ErrorBoundary } from "@/components/error-boundary";
import { AiBudgetBanner } from "@/components/ai-budget-banner";
import { DesktopBridge } from "@/components/desktop-bridge";
import { PlatformBanner } from "@/components/platform-banner";
import { OfflineBanner } from "@/components/shell/offline-banner";
import { GlobalShortcuts } from "@/components/shell/global-shortcuts";
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
      <GlobalShortcuts />
      {/* `min-w-0` so a long code block in a chat message cannot widen the flex
          child and push the sidebar off-screen. */}
      <main className="min-w-0 flex-1 overflow-y-auto pt-14 md:pt-0">
        {/* Above the page, not inside it: a maintenance notice explains why the
            thing the user just tried did not work, so it must be visible on
            whichever page they were on when it did not. */}
        <PlatformBanner />
        {/* When the server cannot be reached: which features stop and which keep working. */}
        <OfflineBanner />
        {/* Beside it for the same reason: a spending cap is why the next request fails. */}
        <AiBudgetBanner />
        {/* Nothing in a browser; in the desktop shell, links and the tray (ROAD_TO_10 4.7). */}
        <DesktopBridge />
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </div>
  );
}
