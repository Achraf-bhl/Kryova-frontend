"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import type { OrganisationMembership, ShareLink, ShareLinkIssued } from "@/types/api";

/**
 * Sharing a project outside Kryova, and moving it to another team (P2.5).
 *
 * **The token is shown exactly once and is not recoverable.** The panel keeps
 * the freshly issued link on screen until the user dismisses it, because
 * nothing — not this list, not the API, not the database — can produce it
 * again. A UI that let it scroll away would be a link nobody can send.
 *
 * The list shows revoked and expired links too. "Who did we share this with,
 * and is it still open" is one question; dropping the dead rows answers only
 * half of it.
 */
export function SharePanel({ projectId }: { projectId: string }) {
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [issued, setIssued] = useState<ShareLinkIssued | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(14);
  const [allowDownload, setAllowDownload] = useState(false);

  const load = useCallback(() => {
    api
      .listShareLinks(projectId)
      .then((rows) => {
        setLinks(rows);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [projectId]);

  useEffect(load, [load]);

  async function issue(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const link = await api.createShareLink(projectId, {
        label: label.trim() || undefined,
        days,
        allow_geometry_download: allowDownload,
      });
      setIssued(link);
      setLabel("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-accent">Share this project</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          A read-only link a supplier or customer can open without an account. It expires, and
          you can withdraw it at any time.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" onSubmit={issue}>
        <Input
          id="share-label"
          label="Who is it for?"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Acme, for quoting"
        />
        <Input
          id="share-days"
          label="Days until it expires"
          type="number"
          min={1}
          max={365}
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
        />
        <label className="flex h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allowDownload}
            onChange={(event) => setAllowDownload(event.target.checked)}
            className="size-4 rounded-sm border-border"
          />
          {/* Off by default. Sending somebody your results and sending them
              your geometry are different decisions. */}
          Let them download the CAD
        </label>
        <Button type="submit" loading={busy}>
          Create link
        </Button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {issued && (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
          <p className="text-sm font-medium text-accent">
            Copy this link now — we cannot show it again
          </p>
          <p className="mt-2 font-mono text-xs break-all">{issued.url}</p>
          <div className="mt-2 flex gap-3">
            <Button
              variant="secondary"
              className="h-8 px-3 text-xs"
              onClick={() => void navigator.clipboard?.writeText(issued.url)}
            >
              Copy
            </Button>
            <Button
              variant="secondary"
              className="h-8 px-3 text-xs"
              onClick={() => setIssued(null)}
            >
              I have saved it
            </Button>
          </div>
        </div>
      )}

      {links && links.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
          {links.map((link) => (
            <ShareRow key={link.id} projectId={projectId} link={link} onChanged={load} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ShareRow({
  projectId,
  link,
  onChanged,
}: {
  projectId: string;
  link: ShareLink;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const expired = new Date(link.expires_at) <= new Date();
  const dead = link.revoked_at !== null || expired;

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {link.label ?? "Untitled link"}
          {link.allow_geometry_download && (
            <span className="ml-2 text-xs text-muted">includes CAD</span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {link.revoked_at
            ? `withdrawn ${relativeTime(link.revoked_at)}`
            : expired
              ? "expired"
              : `expires ${new Date(link.expires_at).toLocaleDateString()}`}
          {" · "}
          {link.view_count === 0
            ? "not opened yet"
            : `opened ${link.view_count} ${link.view_count === 1 ? "time" : "times"}`}
        </p>
      </div>
      {!dead && (
        <Button
          variant="secondary"
          className="h-8 px-3 text-xs"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.revokeShareLink(projectId, link.id);
              onChanged();
            } finally {
              setBusy(false);
            }
          }}
        >
          Withdraw
        </Button>
      )}
    </li>
  );
}

/**
 * Moving a project to another team.
 *
 * Separate from the share panel because it is a different kind of act: sharing
 * is additive and reversible, a transfer changes who owns the work and revokes
 * every live link on the way. The confirmation step exists for that reason and
 * not for symmetry.
 */
export function TransferPanel({
  projectId,
  organisations,
}: {
  projectId: string;
  organisations: OrganisationMembership[];
}) {
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);

  // Only teams the caller administers can receive a project — the backend
  // answers 404 for the others, so offering them would be offering a failure.
  const eligible = organisations.filter(
    (org) => org.role === "owner" || org.role === "admin",
  );
  if (eligible.length < 2) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-accent">Move to another team</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          The project and everything in it — geometry, simulations, conversations — move
          together. Any live share links are withdrawn.
        </p>
      </div>
      {moved ? (
        <p className="text-sm text-success">Moved. Reload to see it in its new team.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-sm" htmlFor="transfer-target">
            <span className="font-medium text-muted">Team</span>
            <select
              id="transfer-target"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="h-10 rounded-md border border-border bg-surface px-3 text-accent outline-none focus:border-primary"
            >
              <option value="">Choose a team…</option>
              {eligible.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
          <Input
            id="transfer-reason"
            label="Why (optional)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          {confirming ? (
            <>
              <Button
                variant="danger"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await api.transferProject(projectId, target, reason || undefined);
                    setMoved(true);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not move it");
                  } finally {
                    setBusy(false);
                    setConfirming(false);
                  }
                }}
              >
                Yes, move it
              </Button>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              disabled={!target}
              onClick={() => setConfirming(true)}
            >
              Move
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
