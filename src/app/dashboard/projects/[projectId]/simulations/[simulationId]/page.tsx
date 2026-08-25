"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { WebGLStressViewer } from "@/components/webgl-stress-viewer";
import { SkeletonGrid } from "@/components/skeleton";
import { api } from "@/lib/api-client";
import { formatDuration, statusColor } from "@/lib/format";
import type { SimulationRead, SurfaceField } from "@/types/api";

const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED"]);

/** Poll interval floor, and the ceiling it backs off to.
 *
 * A job that finishes in seconds should feel instant, but a large mesh can
 * solve for many minutes and there is no reason to keep asking every 1.5s for
 * all of it. The interval grows once the run is clearly not a quick one.
 */
const POLL_MIN_MS = 1_500;
const POLL_MAX_MS = 15_000;
const POLL_GROWTH = 1.35;
/** Stop polling entirely after this long; the page offers a manual retry. */
const POLL_GIVE_UP_MS = 30 * 60 * 1_000;

export default function SimulationPage() {
  const params = useParams<{ projectId: string; simulationId: string }>();
  const { projectId, simulationId } = params;

  const [simulation, setSimulation] = useState<SimulationRead | null>(null);
  const [surface, setSurface] = useState<SurfaceField | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let consecutiveErrors = 0;
    let interval = POLL_MIN_MS;
    const startedAt = Date.now();

    async function poll() {
      try {
        const data = await api.readSimulation(projectId, simulationId);
        if (cancelled) return;
        consecutiveErrors = 0;
        setSimulation(data);
        if (TERMINAL_STATUSES.has(data.status)) return;

        if (Date.now() - startedAt > POLL_GIVE_UP_MS) {
          setError(
            "This run has been going for over 30 minutes, so we stopped checking. " +
              "Reload the page to resume.",
          );
          return;
        }
        // Back off towards the ceiling: quick jobs stay responsive, long ones
        // stop hammering the API for the rest of their runtime.
        interval = Math.min(interval * POLL_GROWTH, POLL_MAX_MS);
        timer = setTimeout(poll, interval);
      } catch (err) {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load simulation");
          return;
        }
        const delay = POLL_MIN_MS * Math.pow(2, consecutiveErrors - 1);
        timer = setTimeout(poll, delay);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, simulationId]);

  useEffect(() => {
    if (simulation?.status !== "SUCCEEDED") return;
    api
      .surfaceField(projectId, simulationId)
      .then(setSurface)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load results"));
  }, [projectId, simulationId, simulation?.status]);

  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }

  if (!simulation) {
    return (
      <div className="flex flex-col gap-6">
        <SkeletonGrid count={4} />
      </div>
    );
  }

  const result = simulation.result;

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
          <span className={`text-sm font-semibold ${statusColor(simulation.status)}`}>
            {simulation.status === "QUEUED" && "Queued…"}
            {simulation.status === "RUNNING" && "Solving…"}
            {simulation.status}
          </span>
        </div>
      </div>

      {simulation.error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-danger">
          {simulation.error}
        </div>
      )}

      {!TERMINAL_STATUSES.has(simulation.status) && (
        <div className="flex items-center gap-3 rounded-lg bg-surface p-5 shadow-card">
          <span className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted">
            Meshing and solving — this page will update automatically.
          </span>
        </div>
      )}

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

      {surface && simulation.status === "SUCCEEDED" && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Von Mises stress</h2>
          <WebGLStressViewer data={surface} />
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "danger" | "warn" }) {
  return (
    <div className="rounded-lg bg-surface p-4 shadow-card">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone === "danger" ? "text-danger" : ""}`}>
        {value}
      </p>
    </div>
  );
}
