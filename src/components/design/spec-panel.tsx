"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api-client";
import { isDerived, type DesignRead, type SpecFeature, type SpecParameter } from "@/types/api";

/**
 * The design as an artefact, beside the chat (P5 task 3).
 *
 * **The conversation is the log; the spec is the truth**, and this panel is that
 * hierarchy made visible. Until the design record was persisted there was
 * nothing to render here and the task said so; `app/models/design.py` is what
 * changed.
 *
 * Three things it does that a read-only dump of the spec would not.
 *
 * **A derived parameter cannot be edited, and says why.** The backend refuses to
 * set one — overwriting a consequence with a literal leaves a formula in the
 * design that no longer describes the value — and the field is disabled here
 * rather than left to fail on submit. Showing the formula in place of an input
 * is the whole explanation: `fillet_mm = thick_mm / 2` tells a reader what to
 * change instead, which an error message after the fact does not.
 *
 * **An edit reports what it reaches, including what nobody touched.** The
 * response carries the same `SpecDiff` the approval gate renders, and its
 * `downstream` list is the one an engineer is most likely to be surprised by:
 * those features were not edited, they stand on something that was, and they
 * may come out a different shape.
 *
 * **Rationale notes are shown, not hidden behind a hover.** `note` is the answer
 * to "why is this rib here" in six months, and a rationale slot nobody reads is
 * a rationale slot nobody fills in.
 *
 * It is pinned beside the composer rather than placed in the transcript, for the
 * same reason `KernelPartView` is: this says what is true *now*. A copy of the
 * spec next to turn 3 would quietly become turn 9's design.
 */

type Loaded =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "ready"; design: DesignRead }
  | { kind: "failed"; message: string };

export interface SpecPanelProps {
  conversationId: string;
  /**
   * Bumped by the caller whenever the design may have moved — in practice once
   * per finished turn. Not a timer: a spec changes when the agent records one,
   * and polling would spend requests asking an unchanged design to re-send
   * itself.
   */
  revision: number;
}

export function SpecPanel({ conversationId, revision }: SpecPanelProps) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [open, setOpen] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [lastEdit, setLastEdit] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .readDesign(conversationId)
      .then((design) => {
        if (!cancelled) setLoaded({ kind: "ready", design });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A conversation with no design yet is the ordinary case, not a
        // failure: most conversations never record one. It renders as nothing
        // at all rather than as an empty panel, because a permanent "no design"
        // box above every composer is furniture.
        if (error instanceof ApiError && error.status === 404) {
          setLoaded({ kind: "none" });
          return;
        }
        setLoaded({
          kind: "failed",
          message: error instanceof ApiError ? error.message : "The design could not be read.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, revision]);

  const edit = useCallback(
    async (name: string, raw: string) => {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        setEditError(`${name} needs a number.`);
        return;
      }
      setPending(name);
      setEditError(null);
      try {
        const result = await api.setDesignParameter(conversationId, name, value);
        setLoaded({ kind: "ready", design: result.design });
        setLastEdit(
          result.changed
            ? describeReach(result.diff)
            : `${name} was already ${value}, so nothing changed.`,
        );
      } catch (error: unknown) {
        setEditError(
          error instanceof ApiError ? error.message : `${name} could not be changed.`,
        );
      } finally {
        setPending(null);
      }
    },
    [conversationId],
  );

  if (loaded.kind === "none" || loaded.kind === "loading") return null;

  if (loaded.kind === "failed") {
    return (
      <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted">
        {loaded.message}
      </div>
    );
  }

  const { design } = loaded;
  const spec = design.document;

  return (
    <section
      className="rounded-md border border-border bg-surface text-sm"
      aria-label={`Design specification for ${spec.name}`}
    >
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-medium">{spec.name}</span>
          <span className="shrink-0 text-xs text-muted">
            revision {design.revision_number}
            {spec.material ? ` · ${spec.material}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border px-3 py-2.5">
          {spec.description && <p className="text-xs text-muted">{spec.description}</p>}

          <ParameterList
            parameters={spec.parameters}
            pending={pending}
            onEdit={edit}
          />

          {editError && (
            <p role="alert" className="text-xs text-danger">
              {editError}
            </p>
          )}
          {lastEdit && !editError && <p className="text-xs text-muted">{lastEdit}</p>}

          <FeatureList features={spec.features} />

          {/* The identity of this design version, and what an approval gate
              pins. Truncated because sixty-four hex characters in a side panel
              is noise, and shown at all because "which design was signed off"
              is answered with this string and nothing else. */}
          <p className="text-[11px] text-muted">
            digest <code className="font-mono">{design.digest.slice(0, 12)}</code>
          </p>
        </div>
      )}
    </section>
  );
}

function ParameterList({
  parameters,
  pending,
  onEdit,
}: {
  parameters: SpecParameter[];
  pending: string | null;
  onEdit: (name: string, value: string) => void;
}) {
  if (parameters.length === 0) {
    return <p className="text-xs text-muted">This design declares no parameters.</p>;
  }
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
        Parameters
      </h3>
      <ul className="space-y-1">
        {parameters.map((parameter) => (
          <li key={parameter.name} className="flex items-baseline gap-2">
            <span className="w-36 shrink-0 truncate font-mono text-xs">{parameter.name}</span>
            {isDerived(parameter) ? (
              // The formula in place of an input is the whole explanation: it
              // says what to change instead. A disabled box with no reason
              // reads as a bug.
              <span
                className="flex-1 truncate font-mono text-xs text-muted"
                title={`Derived from ${parameter.expression}`}
              >
                = {parameter.expression}
              </span>
            ) : (
              <ParameterInput
                // Keyed on the stored value, so a change from the server —
                // the agent moving a parameter mid-turn — remounts the field
                // with the new number in it. The alternative is an effect that
                // calls `setState`, which this repo's lint refuses and is right
                // to: a field still showing what the reader typed two minutes
                // ago lets them commit over a change they never saw.
                key={`${parameter.name}:${parameter.value ?? ""}`}
                parameter={parameter}
                busy={pending === parameter.name}
                onCommit={(value) => onEdit(parameter.name, value)}
              />
            )}
            {parameter.unit && (
              <span className="shrink-0 text-xs text-muted">{parameter.unit}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ParameterInput({
  parameter,
  busy,
  onCommit,
}: {
  parameter: SpecParameter;
  busy: boolean;
  onCommit: (value: string) => void;
}) {
  const stored = parameter.value ?? "";
  // Initialised once per mount, and the caller's `key` is what remounts this
  // when the stored value moves. See there for why that is not an effect.
  const [draft, setDraft] = useState(String(stored));

  const dirty = draft !== String(stored);

  return (
    <input
      type="number"
      value={draft}
      disabled={busy}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => dirty && onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (dirty) onCommit(draft);
        }
        if (event.key === "Escape") setDraft(String(stored));
      }}
      aria-label={parameter.description || parameter.name}
      className="w-24 rounded-sm border border-border bg-transparent px-1.5 py-0.5 font-mono text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-50"
    />
  );
}

function FeatureList({ features }: { features: SpecFeature[] }) {
  if (features.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
        Features, in build order
      </h3>
      <ol className="space-y-1">
        {features.map((feature) => (
          <li key={feature.name} className="text-xs">
            <span className="font-mono">{feature.name}</span>
            <span className="text-muted"> · {feature.op}</span>
            {feature.when && (
              // Shown rather than hidden: a feature that only exists above a
              // certain thickness is not in the part a reader is looking at
              // unless the condition holds, and a list that renders it
              // identically to an unconditional one is lying by omission.
              <span className="text-muted"> · only when {feature.when}</span>
            )}
            {feature.note && <p className="text-muted">{feature.note}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * What an edit reached, in one sentence.
 *
 * Reads the diff the backend already computed rather than deriving anything —
 * `app/design/diff.py` is the single implementation of "does this change the
 * part", and a second answer here would disagree with the gate's the first time
 * somebody rewrote a rationale note.
 */
function describeReach(diff: Record<string, unknown> | null): string {
  if (!diff) return "Saved.";
  if (diff.plan_changed !== true) {
    return "Saved. Nothing that affects the built part changed.";
  }
  const affected = Array.isArray(diff.affected) ? diff.affected.length : 0;
  const downstream = Array.isArray(diff.downstream) ? (diff.downstream as string[]) : [];
  const head = `Saved. Rebuilds ${affected} feature${affected === 1 ? "" : "s"}`;
  if (downstream.length === 0) return `${head}.`;
  // Named, not counted. These are the ones nobody edited, and a reviewer who
  // sees only what they typed is the one who approves a wall thickness and
  // silently moves the bore pattern cut into it.
  return `${head}, including ${downstream.join(", ")}, which nobody edited but which stand on something that was.`;
}
