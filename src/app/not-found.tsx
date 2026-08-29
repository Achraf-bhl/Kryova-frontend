import Link from "next/link";

/**
 * Shown for an unknown URL and for any `notFound()` a route calls.
 *
 * The backend answers 404 — never 403 — for a resource owned by someone else,
 * so this copy must not imply a permissions problem. "Not found" is all we
 * actually know, and all we should say.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg bg-surface p-8 text-center shadow-card">
        <p className="font-mono text-sm text-muted">404</p>
        <h1 className="mt-2 text-lg font-semibold">Not found</h1>
        <p className="mt-2 text-sm text-muted">
          This page, project or simulation does not exist, or it has been deleted.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-white shadow-card hover:bg-primary/90"
        >
          Back to projects
        </Link>
      </div>
    </div>
  );
}
