"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ResultInterpretationPanel } from "@/components/result-interpretation";
import { WebGLStressViewer } from "@/components/webgl-stress-viewer";
import { SkeletonGrid } from "@/components/skeleton";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { api } from "@/lib/api-client";
import { formatDuration, statusColor } from "@/lib/format";
import {
  initialPollState,
  nextAfterError,
  nextAfterSuccess,
  type PollScheduleState,
} from "@/lib/poll-schedule";
import type { SurfaceFieldArrays } from "@/lib/surface-field";
import { isTerminalStatus, jobStatusLabel, type SimulationRead } from "@/types/api";

/** The padded container the dashboard layout no longer imposes — see PageShell. */
export default function SimulationPage() {
  return (
    <PageShell>
      <SimulationDetail />
    </PageShell>
  );
}

function SimulationDetail() {
  const params = useParams<{ projectId: string; simulationId: string }>();
  const { projectId, simulationId } = params;

  const [simulation, setSimulation] = useState<SimulationRead | null>(null);
  const [surface, setSurface] = useState<SurfaceFieldArrays | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by the retry button to restart polling from scratch. */
  const [pollAttempt, setPollAttempt] = useState(0);

  const retry = useCallback(() => {
    setError(null);
    setPollAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let state: PollScheduleState = initialPollState();
    const startedAt = Date.now();

    async function poll() {
      try {
        const data = await api.readSimulation(projectId, simulationId);
        if (cancelled) return;
        setSimulation(data);
        const step = nextAfterSuccess(
          state,
          isTerminalStatus(data.status),
          Date.now() - startedAt,
        );
        state = step.state;
        if (step.decision.action === "wait") {
          timer = setTimeout(poll, step.decision.delayMs);
        } else if (step.decision.action === "give-up") {
          setError(
            "This run has been going for over 30 minutes, so we stopped checking on it. " +
              "The solve is still running on the server — check again to pick it back up.",
          );
        }
      } catch (err) {
        if (cancelled) return;
        const step = nextAfterError(state, Date.now() - startedAt);
        state = step.state;
        if (step.decision.action === "wait") {
          timer = setTimeout(poll, step.decision.delayMs);
        } else {
          setError(err instanceof Error ? err.message : "Failed to load simulation");
        }
      }
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, simulationId, pollAttempt]);

  useEffect(() => {
    let cancelled = false;
    if (simulation?.status !== "succeeded") return;
    api
      .surfaceFieldBinary(projectId, simulationId)
      .catch(() => api.surfaceField(projectId, simulationId))
      .then((data) => {
        if (!cancelled) setSurface(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load results");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, simulationId, simulation?.status]);

  if (error) {
    return (
      <div className="flex flex-col gap-4 rounded-lg bg-surface p-6 shadow-card">
        <p className="text-sm text-danger">{error}</p>
        <div className="flex gap-3">
          <Button onClick={retry}>Check again</Button>
          <Link
            href={`/dashboard/projects/${projectId}`}
            className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium"
          >
            Back to project
          </Link>
        </div>
      </div>
    );
  }

  if (!simulation) {
    return (
      <div className="flex flex-col gap-6">
        <SkeletonGrid count={4} />
      </div>
    );
  }

  const result = simulation.result;
  const meshStats = toEntries(simulation.mesh_stats);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/dashboard/projects/${projectId}`} className="text-sm text-muted hover:text-accent">
          ← Back to project
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {typeof simulation.load_case?.name === "string" ? simulation.load_case.name : "Simulation"}
          </h1>
          <span className={`font-mono text-sm font-semibold ${statusColor(simulation.status)}`}>
            {jobStatusLabel(simulation.status)}
            {isTerminalStatus(simulation.status) ? "" : "…"}
          </span>
        </div>
      </div>

      {simulation.error && (
        <div className="rounded-lg border border-danger/30 bg-surface p-4 text-sm text-danger shadow-card">
          {simulation.error}
        </div>
      )}

      {!isTerminalStatus(simulation.status) && (
        <div className="flex items-center gap-3 rounded-lg bg-surface p-5 shadow-card">
          <span className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted">
            Meshing and solving — this page will update automatically.
          </span>
        </div>
      )}

      {/* Solver warnings come before the numbers on purpose: they are the
          caveats that decide whether the numbers below mean anything. */}
      {result && result.warnings.length > 0 && <SolverWarnings warnings={result.warnings} />}

      {result && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Max von Mises" value={`${result.max_von_mises_mpa.toFixed(1)} MPa`} />
          <StatCard label="Max displacement" value={`${result.max_displacement_mm.toExponential(2)} mm`} />
          <StatCard
            label="Factor of safety"
            value={result.factor_of_safety.toFixed(2)}
            tone={result.factor_of_safety < 1 ? "danger" : result.factor_of_safety < 1.5 ? "warn" : undefined}
          />
          <StatCard label="Mass" value={`${result.mass_kg.toFixed(2)} kg`} />
          <StatCard label="Volume" value={`${result.volume_mm3.toLocaleString(undefined, { maximumFractionDigits: 0 })} mm³`} />
          <StatCard label="Nodes" value={result.node_count.toLocaleString()} />
          <StatCard label="Elements" value={result.element_count.toLocaleString()} />
          <StatCard label="Solve time" value={formatDuration(result.solve_seconds)} />
          <StatCard
            label="Status"
            value={result.yields ? "Yields" : "No yield"}
            tone={result.yields ? "danger" : undefined}
          />
        </div>
      )}

      {meshStats.length > 0 && (
        <section className="rounded-lg bg-surface p-5 shadow-card">
          <h2 className="text-sm font-semibold">Mesh</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {meshStats.map(([key, value]) => (
              <div key={key} className="flex justify-between gap-3 border-b border-border/60 pb-1">
                <dt className="text-muted">{humanizeKey(key)}</dt>
                <dd className="font-mono text-xs">{value}</dd>
              </div>
            ))}
          </dl>
          {simulation.element_size_mm !== null && (
            <p className="mt-3 text-xs text-muted">
              Target element size{" "}
              <span className="font-mono text-accent">{simulation.element_size_mm} mm</span>.
              Halving it multiplies element count by roughly eight.
            </p>
          )}
        </section>
      )}

      {simulation.status === "succeeded" && (
        <ResultInterpretationPanel
          projectId={projectId}
          simulationId={simulationId}
        />
      )}

      {surface && simulation.status === "succeeded" && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Von Mises stress</h2>
          <WebGLStressViewer data={surface} />
        </section>
      )}
    </div>
  );
}

/**
 * Solver warnings, rendered prominently.
 *
 * These are the solver telling the engineer that a result is qualified —
 * a badly conditioned stiffness matrix, an under-constrained body, elements
 * below the quality threshold. Fetching them and not showing them lets someone
 * sign off on a number the solver already flagged.
 */
function SolverWarnings({ warnings }: { warnings: string[] }) {
  return (
    <section className="rounded-lg border border-danger/30 bg-surface p-5 shadow-card">
      <h2 className="text-sm font-semibold text-danger">
        {warnings.length === 1 ? "Solver warning" : `${warnings.length} solver warnings`}
      </h2>
      <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm">
        {warnings.map((warning, index) => (
          <li key={`${index}-${warning}`}>{warning}</li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">
        Results are still shown, but read them with these in mind.
      </p>
    </section>
  );
}

/** Flatten the backend's free-form `mesh_stats` into printable pairs. */
function toEntries(stats: Record<string, unknown> | null): Array<[string, string]> {
  if (!stats) return [];
  return Object.entries(stats).flatMap(([key, value]) => {
    if (value === null || value === undefined) return [];
    if (typeof value === "number") {
      const formatted = Number.isInteger(value)
        ? value.toLocaleString()
        : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
      return [[key, formatted] as [string, string]];
    }
    if (typeof value === "string" || typeof value === "boolean") {
      return [[key, String(value)] as [string, string]];
    }
    // Nested objects/arrays are rare and unlabelled; showing raw JSON is more
    // honest than dropping them silently.
    return [[key, JSON.stringify(value)] as [string, string]];
  });
}

function humanizeKey(key: string): string {
  const spaced = key.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "danger" | "warn" }) {
  // Every one of these carries a unit, so every one is set in the mono face:
  // in an FEA product that is semantic, not stylistic — a measurement must not
  // read as prose. `warn` used to be accepted and then ignored, which meant a
  // factor of safety of 1.2 rendered exactly like one of 4.0.
  const toneClass =
    tone === "danger" ? "text-danger" : tone === "warn" ? "text-warning" : "text-accent";
  return (
    <div className="k-panel p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1 font-mono text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}
