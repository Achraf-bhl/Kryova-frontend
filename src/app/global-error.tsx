"use client";

import { useEffect } from "react";

import "./globals.css";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Last-resort boundary: catches errors thrown by the root layout itself, where
 * `app/error.tsx` never gets a chance to render.
 *
 * Because it replaces the root layout, it has to supply its own `<html>` and
 * `<body>` — and it cannot rely on anything the layout provides, including the
 * font variable. Styling is therefore kept to Tailwind's own tokens plus the
 * semantic ones in `globals.css`, which this file imports directly.
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("Fatal application error", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="w-full max-w-md rounded-lg bg-surface p-8 shadow-card">
            <h1 className="text-lg font-semibold text-danger">Kryova could not start</h1>
            <p className="mt-2 text-sm text-muted">
              Something failed before the app finished loading. Reloading usually clears
              it; if it does not, the API is likely down.
            </p>
            {error.digest && (
              <p className="mt-4 rounded-md border border-border bg-canvas p-3 font-mono text-xs text-muted">
                Reference: {error.digest}
              </p>
            )}
            <button
              type="button"
              onClick={reset}
              className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-white shadow-card hover:bg-primary/90"
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
