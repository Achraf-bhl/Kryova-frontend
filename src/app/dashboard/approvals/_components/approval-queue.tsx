"use client";

import { useCallback, useEffect, useState } from "react";

import { SpecDiff } from "@/components/gates/spec-diff";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import type { GateRead, GateState, OrganisationMembership } from "@/types/api";

/**
 * The approvals surface (P5.5).
 *
 * Three rules it exists to make visible, all of which live in the backend and
 * none of which this component may soften:
 *
 * 1. **A decision is against a digest.** The subject is sent back as it stands
 *    now, and a `409` means it moved while the gate was pending. That refusal
 *    is rendered as the useful thing it is — "look again" — not as an error.
 * 2. **A rejection carries a reason.** The reject button stays disabled until
 *    there is one, because what happens next depends entirely on why.
 * 3. **Expired is not rejected.** It is rendered in muted grey with its own
 *    word, never in the red a refusal gets: nobody made that decision.
 */

const STATE_STYLE: Record<GateState, { className: string; label: string }> = {
  pending: { className: "text-warning", label: "waiting on somebody" },
  approved: { className: "text-success", label: "approved" },
  rejected: { className: "text-danger", label: "rejected" },
  // Grey, and its own sentence. See rule 3.
  expired: { className: "text-muted", label: "expired undecided" },
};

const FILTERS: ReadonlyArray<{ value: GateState | ""; label: string }> = [
  { value: "pending", label: "Waiting" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  // Its own entry, never merged with "Rejected". An expired gate was not
  // refused: nobody decided it.
  { value: "expired", label: "Expired undecided" },
  { value: "", label: "Everything" },
];

export function ApprovalQueue() {
  const [organisations, setOrganisations] = useState<OrganisationMembership[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<GateState | "">("pending");
  const [gates, setGates] = useState<GateRead[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listOrganisations()
      .then((page) => {
        setOrganisations(page.items);
        setSelectedId((current) => current ?? page.items[0]?.id ?? null);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const load = useCallback(() => {
    if (!selectedId) return;
    // No `setGates(null)` here. It would blank the list on every filter change,
    // and `react-hooks/set-state-in-effect` is right that a synchronous setState
    // in an effect body is the wrong shape — the rows swap when the new page
    // arrives, which for a list this short is a frame either way.
    api
      .listGates(selectedId, filter ? { state: filter } : {})
      .then((page) => setGates(page.items))
      .catch((err: Error) => setError(err.message));
  }, [selectedId, filter]);

  useEffect(load, [load]);

  if (error && !gates) {
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {organisations && organisations.length > 1 && (
          <Select
            label="Team"
            value={selectedId ?? ""}
            onChange={(event) => setSelectedId(event.target.value)}
            options={organisations.map((organisation) => ({
              value: organisation.id,
              label: organisation.name,
            }))}
          />
        )}
        <Select
          label="Show"
          value={filter}
          onChange={(event) => setFilter(event.target.value as GateState | "")}
          options={FILTERS}
        />
      </div>

      {gates === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : gates.length === 0 ? (
        <p className="text-sm text-muted">
          {filter === "pending"
            ? "Nothing is waiting on you."
            : "Nothing here yet."}
        </p>
      ) : (
        <ul className="space-y-4">
          {gates.map((gate) => (
            <li key={gate.id}>
              <GateCard
                gate={gate}
                organisationId={selectedId ?? ""}
                onDecided={load}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GateCard({
  gate,
  organisationId,
  onDecided,
}: {
  gate: GateRead;
  organisationId: string;
  onDecided: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const style = STATE_STYLE[gate.state];

  /**
   * The subject as it stands now.
   *
   * `evidence.subject` is what the backend was given when the gate was raised
   * and is what it will compare against. Sending it back unchanged means this
   * page confirms the design has not moved *only when it genuinely has not* —
   * a page that re-fetched the live design and sent that would be the correct
   * shape once the spec panel is wired to a live document, and is the one line
   * to change then. Sending `subject_digest` back would make the check a
   * tautology and is the thing never to do.
   */
  const subject = (gate.evidence as { subject?: unknown }).subject ?? null;

  async function decide(approve: boolean) {
    setBusy(true);
    setRefusal(null);
    try {
      await api.decideGate(organisationId, gate.id, {
        approve,
        subject,
        note: note.trim() || undefined,
      });
      onDecided();
    } catch (err) {
      setRefusal(err instanceof Error ? err.message : "That could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{gate.title}</h2>
        <span className={`text-xs ${style.className}`}>{style.label}</span>
      </header>

      <p className="text-sm text-muted">{gate.question}</p>

      <SpecDiff evidence={gate.evidence} />

      <p className="text-xs text-faint">
        Raised {relativeTime(gate.created_at)}
        {gate.expires_at && gate.state === "pending" && (
          <> · expires {relativeTime(gate.expires_at)}</>
        )}
        {gate.decided_at && <> · decided {relativeTime(gate.decided_at)}</>}
      </p>

      {gate.decision_note && (
        <p className="rounded-md border border-border bg-canvas px-3 py-2 text-sm">
          {gate.decision_note}
        </p>
      )}

      {gate.state === "pending" && (
        <div className="space-y-2 border-t border-border pt-3">
          <label className="block text-sm">
            <span className="text-muted">
              Reason{" "}
              <span className="text-faint">(required to reject, optional to approve)</span>
            </span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              className="mt-1 block w-full resize-y rounded-md border border-border bg-canvas px-2 py-1.5 text-sm outline-none focus:border-border-strong"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void decide(true)} disabled={busy}>
              Approve
            </Button>
            <Button
              variant="secondary"
              onClick={() => void decide(false)}
              // Disabled rather than refused on submit: the backend refuses a
              // bare "no" anyway, and finding that out after clicking teaches
              // nothing that the label above has not already said.
              disabled={busy || note.trim().length === 0}
            >
              Reject
            </Button>
          </div>
          {refusal && (
            <p role="alert" className="text-sm text-warning">
              {refusal}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
