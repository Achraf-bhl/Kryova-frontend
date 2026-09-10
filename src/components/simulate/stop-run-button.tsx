"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import type { JobStatus, SimulationRead } from "@/types/api";

/**
 * Stop a run (P5.6), and say honestly what that achieved.
 *
 * **A queued run and a running one stop differently**, and this button reports
 * the difference rather than smoothing it over. The backend answers with the
 * run's *actual* status: `cancelled` for a queued job, still `running` for one
 * already inside CalculiX. That one stops at its next stage boundary — after
 * meshing, or between the grids of a study — because meshing and solving are
 * each a single call the API cannot reach into.
 *
 * So the copy says the compute already used is still billed. A cancel does not
 * make machine time retroactively free, and a button that implied it did would
 * be exactly the small lie a billing dispute is built out of.
 */
export function StopRunButton({
  projectId,
  simulationId,
  status,
  onStopped,
}: {
  projectId: string;
  simulationId: string;
  status: JobStatus;
  onStopped: (simulation: SimulationRead) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.cancelSimulation(projectId, simulationId);
      onStopped(updated);
      setNote(
        updated.status === "cancelled"
          ? "Stopped. It had not started, so nothing was spent."
          : "Stopping after the current stage. The solve already running finishes, and the compute it uses is billed.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "That run could not be stopped.");
    } finally {
      setBusy(false);
    }
  }

  if (note) {
    return <p className="text-xs text-muted">{note}</p>;
  }

  return (
    <div className="text-right">
      <Button variant="secondary" onClick={() => void stop()} disabled={busy}>
        {busy ? "Stopping…" : "Stop this run"}
      </Button>
      {status === "running" && (
        <p className="mt-1 text-xs text-faint">
          Stops at the next stage. Compute already used is billed.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
