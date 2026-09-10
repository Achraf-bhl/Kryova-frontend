"use client";

/**
 * A spec change rendered like a code review (P5.3, and the evidence half of
 * P5.5).
 *
 * **Nothing here computes anything.** `app/design/diff.py` already works out
 * both halves the plan asks for — what changed, and what it *reaches* — and
 * `SpecDiff.to_dict()` is the shape below. A second implementation on this side
 * would be a second answer to "does this change the part", and the two would
 * disagree the first time a feature's rationale note was edited: that moves both
 * digests while building a byte-identical part, which `plan_changed` already
 * knows and a naive digest comparison here would not.
 *
 * **Reached-but-unedited is the column people miss.** `changed_calls` is what
 * somebody typed; `downstream` is what stands on it and may come out a different
 * shape without anybody having touched it. A review that showed only the first
 * is the review that approves a wall thickness and silently moves the bore
 * pattern cut into it — so the two are separate lists, labelled differently, and
 * neither is folded into a single "affected" count.
 */

interface ParameterChange {
  name: string;
  before: string | null;
  after: string | null;
}

interface FeatureChange {
  name: string;
  kind: string;
  detail?: string;
}

interface SpecDiffPayload {
  design?: string;
  plan_changed?: boolean;
  parameters?: ParameterChange[];
  material?: { before: string | null; after: string | null } | null;
  features?: FeatureChange[];
  changed_calls?: string[];
  downstream?: string[];
}

export function SpecDiff({ evidence }: { evidence: Record<string, unknown> }) {
  const diff = (evidence.diff ?? evidence.spec_diff) as SpecDiffPayload | undefined;
  if (!diff) return null;

  const parameters = diff.parameters ?? [];
  const features = diff.features ?? [];
  const changed = diff.changed_calls ?? [];
  const downstream = diff.downstream ?? [];

  // `plan_changed === false` is a real and useful answer, not an empty state.
  // "This edit builds the same part" is exactly what a reviewer wants to be
  // told before they spend attention on it.
  if (diff.plan_changed === false) {
    return (
      <p className="rounded-md border border-border bg-canvas px-3 py-2 text-sm text-muted">
        This edit builds the same part. Nothing downstream needs rebuilding or
        re-checking.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-canvas px-3 py-2 text-sm">
      {parameters.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-muted">Parameters</h3>
          <ul className="mt-1 space-y-0.5 font-mono text-xs">
            {parameters.map((change) => (
              <li key={change.name}>
                <ParameterLine change={change} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {diff.material && (
        <section>
          <h3 className="text-xs font-medium text-muted">Material</h3>
          <p className="mt-1 font-mono text-xs">
            <span className="text-danger">{diff.material.before ?? "none"}</span>
            {" → "}
            <span className="text-success">{diff.material.after ?? "none"}</span>
          </p>
        </section>
      )}

      {features.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-muted">Features</h3>
          <ul className="mt-1 space-y-0.5 text-xs">
            {features.map((change) => (
              <li key={`${change.name}-${change.kind}`}>
                <span className="font-mono">{change.name}</span>{" "}
                <span className={change.kind === "removed" ? "text-danger" : "text-accent"}>
                  {change.kind}
                </span>
                {change.detail ? <span className="text-muted"> — {change.detail}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(changed.length > 0 || downstream.length > 0) && (
        <section>
          <h3 className="text-xs font-medium text-muted">What this reaches</h3>
          {changed.length > 0 && (
            <p className="mt-1 text-xs">
              <span className="text-muted">Rebuilt: </span>
              <span className="font-mono">{changed.join(", ")}</span>
            </p>
          )}
          {downstream.length > 0 && (
            <p className="mt-1 text-xs">
              {/* The column people miss. Nobody edited these; they stand on
                  something that was edited, and may come out a different shape.
                  Named separately so a reviewer cannot read them as untouched. */}
              <span className="text-warning">Not edited, but may come out differently: </span>
              <span className="font-mono">{downstream.join(", ")}</span>
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function ParameterLine({ change }: { change: ParameterChange }) {
  if (change.before === null) {
    return (
      <>
        <span className="text-muted">{change.name}</span>{" "}
        <span className="text-success">added as {change.after}</span>
      </>
    );
  }
  if (change.after === null) {
    return (
      <>
        <span className="text-muted">{change.name}</span>{" "}
        <span className="text-danger">removed (was {change.before})</span>
      </>
    );
  }
  return (
    <>
      <span className="text-muted">{change.name}</span>{" "}
      <span className="text-danger">{change.before}</span>
      {" → "}
      {/* An expression, not a number, is a different kind of event: the design
          has changed shape and this value can start moving on its own
          afterwards. `diff.py` keeps the distinction; so does this. */}
      <span className={change.after.startsWith("=") ? "text-warning" : "text-success"}>
        {change.after}
      </span>
    </>
  );
}
