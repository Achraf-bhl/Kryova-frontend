import SignOutButton from "./_components/sign-out-button";

import { ErrorBoundary } from "@/components/error-boundary";
import { fetchCurrentUser } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await fetchCurrentUser();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-5">
            <a href="/dashboard" className="text-base font-semibold">
              Kryova
            </a>
            <a
              href="/dashboard/assistant"
              className="text-sm text-muted transition-colors hover:text-accent"
            >
              Assistant
            </a>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">{user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </div>
  );
}
