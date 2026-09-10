"use client";

import type { SimulationRead } from "@/types/api";

/**
 * Whether a result may be leaned on (P5.4).
 *
 * **Unmeasured is amber and never green.** That is the plan's wording and it is
 * Decision 3 rendered: "an unmeasured claim is never a pass; an unconverged
 * number is worse than no number". A dashboard that painted an unmeasured
 * assertion the same colour as a passing one would undo, at the last inch, the
 * entire apparatus that keeps `UNMEASURED` a first-class outcome in
 * `app/design/assertions.py` and `app/requirements/`.
 *
 * The three states are therefore three colours and three words, and there is
 * deliberately no fourth that means "probably fine".
 */

export type Verdict = "passed" | "failed" | "unmeasured";

const VERDICT_STYLE: Record<Verdict, { className: string; label: string }> = {
  passed: { className: "text-success", label: "met" },
  failed: { className: "text-danger", label: "violated" },
  // Amber, never green. See the component note.
  unmeasured: { className: "text-warning", label: "not measured" },
};

export function VerdictBadge({ verdict, detail }: { verdict: Verdict; detail?: string }) {
  const style = VERDICT_STYLE[verdict];
  return (
    <span className={`text-xs font-medium ${style.className}`} title={detail}>
      {style.label}
    </span>
  );
}

/**
 * A run's mesh-convergence standing, as a badge.
 *
 * **`single-grid` is the default and it is not a pass.** A single solve holds
 * no evidence about its own discretisation error, however fine the mesh was, so
 * `converged` is the only state that earns green. This is the same rule the
 * shared-package page follows, and it exists in two places because the two
 * audiences are different and neither may be told a softer version.
 */
export function ConvergenceBadge({ simulation }: { simulation: SimulationRead }) {
  const result = simulation.result as Record<string, unknown> | null;
  const raw = result?.mesh_convergence;
  const verdict =
    typeof raw === "string"
      ? raw
      : typeof raw === "object" && raw !== null
        ? String((raw as Record<string, unknown>).verdict ?? "")
        : "";

  if (!verdict) {
    return <span className="text-xs text-muted">no convergence record</span>;
  }
  if (verdict === "converged") {
    return <span className="text-xs text-success">mesh converged</span>;
  }
  return (
    <span
      className="text-xs text-warning"
      title="A single solve holds no evidence about its own discretisation error. Run a study with grids: 3 to find out."
    >
      {verdict === "single-grid" ? "one mesh — unverified" : verdict}
    </span>
  );
}

/**
 * Where a number came from, in one line (P5.4's provenance drill-down).
 *
 * `measured`, `approximated` and `unavailable` are the vocabulary
 * `app/kernel/provenance.py` and `app/verify/provenance.py` already use, and
 * this renders them without softening: an approximated value says so beside the
 * number rather than in a tooltip nobody opens, because the whole point is that
 * a reader cannot mistake it for a measurement.
 */
export function ProvenanceNote({
  basis,
  how,
}: {
  basis: string;
  how?: string;
}) {
  if (basis === "measured") {
    return <span className="text-xs text-muted">measured{how ? ` — ${how}` : ""}</span>;
  }
  if (basis === "approximated") {
    return (
      <span className="text-xs text-warning">approximated{how ? ` — ${how}` : ""}</span>
    );
  }
  return (
    <span className="text-xs text-warning">
      not available{how ? ` — ${how}` : ""}
    </span>
  );
}

/**
 * The summary a reader needs before they believe a stress figure.
 *
 * Deliberately renders **nothing reassuring** when there is nothing to say. An
 * empty verification panel that showed "all checks passed" would be the exact
 * failure `app/verify/register.py` guards against on the trust page: prose that
 * has drifted from its own counts.
 */
export function VerificationSummary({ simulation }: { simulation: SimulationRead }) {
  const result = simulation.result as Record<string, unknown> | null;
  if (!result) {
    return (
      <p className="text-sm text-muted">
        This run has produced no result to verify yet.
      </p>
    );
  }

  const solver = simulation.solver;
  const version = (result.solver_version as string | undefined) ?? null;

  return (
    <div className="space-y-2 rounded-md border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">Can this number be leaned on?</span>
        <ConvergenceBadge simulation={simulation} />
      </div>
      <ul className="space-y-1 text-xs text-muted">
        <li>
          Solved by <span className="font-mono text-accent">{solver}</span>
          {version ? ` ${version}` : " (version not recorded)"}.
        </li>
        <li>
          {/* Named rather than implied. A result bound to nothing is a result
              nobody can reproduce, which Decision 3 treats as no result. */}
          Bound to geometry version{" "}
          <span className="font-mono text-accent">{simulation.geometry_version_id.slice(0, 8)}</span>
          , element size{" "}
          <span className="font-mono text-accent">
            {simulation.element_size_mm ?? "auto"}
          </span>{" "}
          mm, order {simulation.element_order}.
        </li>
        {simulation.grids > 1 ? (
          <li>Assessed across {simulation.grids} grids.</li>
        ) : (
          <li className="text-warning">
            One grid. Pass <span className="font-mono">grids: 3</span> to have the
            discretisation error assessed rather than assumed.
          </li>
        )}
      </ul>
    </div>
  );
}
