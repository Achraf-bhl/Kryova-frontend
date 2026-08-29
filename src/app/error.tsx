"use client";

import { useEffect } from "react";

import { ErrorDetail } from "@/components/error-boundary";
import { Button } from "@/components/ui/button";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Route-level error boundary for everything outside `/dashboard`.
 *
 * Without this file a thrown Server Component — a 500 from the backend, say —
 * renders Next's unstyled default page, which says nothing useful and offers no
 * way back. `ErrorDetail` handles the production case where React has redacted
 * `error.message` down to a `digest`.
 */
export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("Unhandled application error", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg bg-surface p-8 shadow-card">
        <h1 className="text-lg font-semibold text-danger">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">
          This page could not be loaded. It is usually a temporary problem reaching the
          Kryova API — retrying often works.
        </p>
        <ErrorDetail error={error} />
        <div className="mt-6 flex gap-3">
          <Button onClick={reset}>Try again</Button>
          <a
            href="/dashboard"
            className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-medium shadow-card"
          >
            Back to projects
          </a>
        </div>
      </div>
    </div>
  );
}
