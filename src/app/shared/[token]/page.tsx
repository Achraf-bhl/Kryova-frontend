"use client";

import { use, useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import type { SharedPackage } from "@/types/api";

/**
 * A read-only design package, for somebody with no Kryova account (P2.5).
 *
 * **Outside every route group on purpose.** `(auth)` wraps a sign-in shell and
 * `dashboard/` is cookie-gated by `src/proxy.ts`; this page is for a supplier
 * or a customer who has neither and should be asked for neither. Its own
 * top-level route means the middleware matcher never sees it.
 *
 * Two rules this page follows that the internal results view also follows, and
 * they matter more here because the reader cannot ask us what a number means:
 *
 * - **Nothing is scaled.** `mass_kg` is already kilograms and stress is already
 *   MPa. The results page shipped a `/1000` here once; a package that repeats
 *   it would be a wrong number in front of a customer.
 * - **`single-grid` is never rendered as a pass.** A peak stress from one mesh
 *   holds no evidence about its own discretisation error, so it is labelled
 *   rather than badged.
 */
export default function SharedPackagePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; package: SharedPackage } | { status: "gone" }
  >({ status: "loading" });

  useEffect(() => {
    api
      .readSharedPackage(token)
      // Every failure is one 404 with one message, by design — expired,
      // withdrawn, never existed, project moved. There is deliberately nothing
      // here to branch on.
      .then((found) => setState({ status: "ready", package: found }))
      .catch(() => setState({ status: "gone" }));
  }, [token]);

  if (state.status === "loading") {
    return <Frame title="Opening…" />;
  }

  if (state.status === "gone") {
    return (
      <Frame title="This link is not available">
        <p className="max-w-prose text-sm text-muted">
          It may have expired, or been withdrawn by whoever sent it. Ask them for a new one.
        </p>
      </Frame>
    );
  }

  const shared = state.package;

  return (
    <Frame title={shared.project_name}>
      <div className="space-y-8">
        <div className="space-y-1">
          {shared.project_description && (
            <p className="max-w-prose text-sm text-muted">{shared.project_description}</p>
          )}
          <p className="text-sm text-muted">
            Shared by <span className="text-accent">{shared.shared_by}</span> at{" "}
            <span className="text-accent">{shared.organisation_name}</span>.
          </p>
          {shared.note && (
            <p className="max-w-prose rounded-md border border-border bg-surface px-3 py-2 text-sm">
              {shared.note}
            </p>
          )}
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-accent">Results</h2>
          {shared.simulations.length === 0 ? (
            <p className="text-sm text-muted">No simulations have been run yet.</p>
          ) : (
            <div className="k-scroll overflow-x-auto">
              <table className="w-full min-w-[42rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="py-2 pr-4 font-medium">Analysis</th>
                    <th className="py-2 pr-4 font-medium">Peak von Mises</th>
                    <th className="py-2 pr-4 font-medium">Peak displacement</th>
                    <th className="py-2 pr-4 font-medium">Mass</th>
                    <th className="py-2 pr-4 font-medium">Mesh</th>
                  </tr>
                </thead>
                <tbody>
                  {shared.simulations.map((run, index) => (
                    <tr key={index} className="border-b border-border/50">
                      <td className="py-2 pr-4">
                        {run.analysis}
                        <span className="ml-2 text-xs text-muted">{run.status}</span>
                      </td>
                      <td className="py-2 pr-4 font-mono">
                        {run.max_von_mises_mpa != null
                          ? `${run.max_von_mises_mpa.toFixed(1)} MPa`
                          : "—"}
                      </td>
                      <td className="py-2 pr-4 font-mono">
                        {run.max_displacement_mm != null
                          ? `${run.max_displacement_mm.toFixed(3)} mm`
                          : "—"}
                      </td>
                      {/* Already kilograms. Do not divide. */}
                      <td className="py-2 pr-4 font-mono">
                        {run.mass_kg != null ? `${run.mass_kg.toFixed(2)} kg` : "—"}
                      </td>
                      <td className="py-2 pr-4">
                        <MeshVerdict verdict={run.mesh_convergence} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-accent">Geometry</h2>
          {shared.geometry.length === 0 ? (
            <p className="text-sm text-muted">No CAD has been uploaded.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
              {shared.geometry.map((version) => (
                <li
                  key={version.version_number}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    v{version.version_number} · {version.filename ?? "unnamed"}
                  </span>
                  {shared.allow_geometry_download ? (
                    <a
                      href={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1"}/share/${token}/geometry/${version.version_number}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Download
                    </a>
                  ) : (
                    <span className="text-xs text-muted">not shared</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-xs text-muted">
          This link stops working on {new Date(shared.expires_at).toLocaleDateString()}.
        </p>
      </div>
    </Frame>
  );
}

/**
 * `single-grid` is the default and it is *not* a pass — a single solve holds no
 * evidence about its own discretisation error. Amber, never green, which is the
 * same rule the internal verification surface follows.
 */
function MeshVerdict({ verdict }: { verdict: string | null }) {
  if (!verdict) return <span className="text-xs text-muted">—</span>;
  if (verdict === "converged") {
    return <span className="text-xs text-success">converged</span>;
  }
  return (
    <span className="text-xs text-warning" title="A single mesh cannot show it has converged">
      {verdict === "single-grid" ? "one mesh — unverified" : verdict}
    </span>
  );
}

function Frame({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">
        Shared from Kryova
      </p>
      <h1 className="mt-1 font-display text-2xl font-semibold">{title}</h1>
      <div className="mt-6">{children}</div>
    </main>
  );
}
