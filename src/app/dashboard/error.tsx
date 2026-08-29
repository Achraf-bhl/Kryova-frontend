"use client";

import { useEffect } from "react";

import { ErrorDetail } from "@/components/error-boundary";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";

interface DashboardErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Error boundary inside the dashboard shell.
 *
 * Nested under `dashboard/layout.tsx`, so the header and sign-out button stay
 * on screen: a failed project fetch should not look like the whole app fell
 * over, and the user keeps a way out of the broken route.
 */
export default function DashboardError({ error, reset }: DashboardErrorProps) {
  useEffect(() => {
    console.error("Dashboard route error", error);
  }, [error]);

  return (
    <PageShell>
      <div className="k-panel p-8">
        <h1 className="font-display text-lg font-semibold text-danger">This page failed to load</h1>
        <p className="mt-2 max-w-prose text-sm text-muted">
          The Kryova API did not answer as expected. Your projects and simulation results
          are unaffected — nothing here writes data.
        </p>
        <ErrorDetail error={error} />
        <div className="mt-6">
          <Button onClick={reset}>Try again</Button>
        </div>
      </div>
    </PageShell>
  );
}
