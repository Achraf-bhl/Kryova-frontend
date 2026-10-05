"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import type { CatiaCheckpoint } from "@/types/catia";

export interface CheckpointTimelineProps {
  conversationId: string;
  /** Called after a rollback succeeded, so the page can refetch whatever shows the part. */
  onRestored?: () => void;
}

function describeSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The restore points of a conversation's CATIA document, and the way back to one.
 *
 * `catia_restore` is destructive, so it needs an approval the *user* signs: the agent is never
 * offered the token and cannot restore on its own. Before this component nothing in the app
 * called the approval route, so the one recovery path in the product could be approved by
 * nobody. The order is deliberate and each step is the user's: a row's button opens a
 * confirmation that says what will be lost, only its confirm button mints the token, and the
 * token is spent in the same breath rather than kept.
 *
 * Loaded when mounted rather than from the server render: a timeline is live state that goes
 * stale the moment the assistant makes its next edit, and it is only mounted once someone
 * opens it.
 */
export function CheckpointTimeline({ conversationId, onRestored }: CheckpointTimelineProps) {
  const [checkpoints, setCheckpoints] = useState<CatiaCheckpoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<CatiaCheckpoint | null>(null);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      setCheckpoints(await api.listCatiaCheckpoints(conversationId));
      setError(null);
    } catch (err) {
      // A conversation with no document yet is not a fault; the server says 404 for it.
      if (err instanceof ApiError && err.status === 404) {
        setCheckpoints([]);
        setError(null);
        return;
      }
      setCheckpoints([]);
      setError(err instanceof Error ? err.message : "Could not load the checkpoints.");
    }
  }, [conversationId]);

  useEffect(() => {
    // Deferred by a microtask, the same shape `device-manager.tsx` uses, so the fetch is not
    // started synchronously inside the effect body.
    void Promise.resolve().then(load);
  }, [load]);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  async function rollBack(checkpoint: CatiaCheckpoint): Promise<void> {
    setWorking(true);
    setError(null);
    setDone(null);
    try {
      const approval = await api.approveCatiaRestore(conversationId, checkpoint.id);
      const result = await api.restoreCatiaCheckpoint(
        conversationId,
        checkpoint.id,
        approval.approval_token,
      );
      setDone(result.message);
      setConfirming(null);
      onRestored?.();
      await load();
    } catch (err) {
      // The server's own words: an offline workstation, an expired approval and a refusal
      // from CATIA are three different next steps.
      setError(err instanceof Error ? err.message : "The rollback could not be completed.");
      setConfirming(null);
    } finally {
      setWorking(false);
    }
  }

  if (checkpoints === null) {
    return (
      <p className="px-4 py-3 text-sm text-muted" aria-live="polite">
        Loading checkpoints…
      </p>
    );
  }

  return (
    <div className="px-4 py-3">
      {error && (
        <p role="alert" className="mb-2 text-sm text-danger">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="mb-2 text-sm text-live">
          {done}
        </p>
      )}

      {checkpoints.length === 0 && !error ? (
        <p className="text-sm text-muted">
          No checkpoints yet. One is saved before each change the assistant makes to the part.
        </p>
      ) : (
        <ol className="k-scroll max-h-56 space-y-1 overflow-y-auto" aria-label="Checkpoints">
          {checkpoints.map((checkpoint) => (
            <li key={checkpoint.id} className="flex items-center gap-2 text-xs">
              <span className="size-1.5 shrink-0 rounded-full bg-border-strong" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-accent" title={checkpoint.label}>
                {checkpoint.label}
              </span>
              {!checkpoint.stored_in_cloud && (
                <span
                  className="shrink-0 rounded-sm bg-surface-sunken px-1.5 py-0.5 text-[0.6875rem] text-muted"
                  title="Only a copy on the workstation exists"
                >
                  workstation only
                </span>
              )}
              <span className="shrink-0 font-mono text-faint">
                {new Date(checkpoint.created_at).toLocaleTimeString()}
                {checkpoint.size_bytes !== null && ` · ${describeSize(checkpoint.size_bytes)}`}
              </span>
              <button
                type="button"
                className="k-pill shrink-0"
                disabled={working}
                onClick={() => setConfirming(checkpoint)}
                aria-label={`Roll back to ${checkpoint.label}`}
              >
                Restore
              </button>
            </li>
          ))}
        </ol>
      )}

      {confirming && (
        <div
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="restore-title"
          aria-describedby="restore-body"
          className="mt-3 rounded-md border border-danger/40 bg-surface-sunken p-3"
        >
          <p id="restore-title" className="text-sm font-medium text-accent">
            Roll the part back to “{confirming.label}”?
          </p>
          <p id="restore-body" className="mt-1 text-sm text-muted">
            Everything built after this checkpoint is discarded from the part in CATIA, and the
            assistant will be told it is gone. This cannot be undone from here.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              ref={cancelRef}
              variant="secondary"
              className="h-8 px-3"
              disabled={working}
              onClick={() => setConfirming(null)}
            >
              Keep the part as it is
            </Button>
            <Button
              variant="danger"
              className="h-8 px-3"
              loading={working}
              onClick={() => void rollBack(confirming)}
            >
              Roll back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
