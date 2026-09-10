import Link from "next/link";

import { DocsBrowser } from "./_components/docs-browser";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Kryova documentation",
  description: "Task-oriented guides, the mission gallery, and the API reference.",
};

/**
 * The docs site (P10.2).
 *
 * **Signed out**, like `/trust` and `/status`: documentation behind a login can
 * only be read by people who already bought, and the person it needs to reach —
 * an engineer working out whether this product does what they need — is exactly
 * the person without an account.
 *
 * Everything on it is derived rather than written twice. The guides' steps are
 * checked against the running router, the mission gallery comes from the ladder
 * that decides whether the product works, and the API reference is built from
 * this deployment's own OpenAPI document. A docs site is the part of a product
 * most likely to quietly stop being true, and deriving it is the only defence
 * that does not depend on somebody remembering.
 */
export default async function DocsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="font-display text-2xl font-semibold">Documentation</h1>
      <p className="mt-1 max-w-prose text-sm text-muted">
        Written against this build, not beside it: every step that names an
        endpoint is checked against the API this deployment actually serves, and
        the mission gallery comes from the suite that decides whether the product
        works.
      </p>
      <p className="mt-2 text-sm text-muted">
        See also{" "}
        <Link href="/trust" className="underline underline-offset-2">
          what Kryova will not claim
        </Link>{" "}
        and the{" "}
        <Link href="/status" className="underline underline-offset-2">
          service status
        </Link>
        .
      </p>
      <div className="mt-8">
        <DocsBrowser />
      </div>
    </main>
  );
}
