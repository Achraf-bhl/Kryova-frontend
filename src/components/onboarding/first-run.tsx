"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";

/**
 * First-run success: a guided M1 in under ten minutes (P10.1).
 *
 * **Every tick is derived from what the account actually contains** — a project
 * row, a geometry version, a succeeded simulation — and never from a "seen the
 * onboarding" flag. That is the whole design. A checklist that ticks from a
 * stored flag is a checklist that can be entirely ticked by somebody who has
 * done none of it, which is worse than no checklist: it tells a stuck user they
 * are finished.
 *
 * It follows from that rule that this **disappears on its own** once there is a
 * successful run, and needs no dismiss button. The reason not to add one is the
 * same reason not to store a flag: a dismissed checklist is a user who is still
 * stuck and now has nothing on screen about it. Somebody who wants it gone
 * finishes it, which takes about ten minutes and is the point.
 *
 * There is deliberately **no local storage** here — `src/lib/token-custody.test.ts`
 * would catch it, and the reasoning above is why it should.
 */

interface Progress {
  hasProject: boolean;
  hasGeometry: boolean;
  hasRun: boolean;
  firstProjectId: string | null;
}

async function readProgress(): Promise<Progress> {
  const projects = await api.listProjects(1, 1);
  const first = projects.items[0];
  if (!first) {
    return { hasProject: false, hasGeometry: false, hasRun: false, firstProjectId: null };
  }

  // Only the first page of each, because the question is "is there any", not
  // "how many". A count endpoint would be a third answer to a question two
  // list endpoints already answer.
  const [geometry, simulations] = await Promise.all([
    api.listGeometry(first.id, { pageSize: 1 }),
    api.listSimulations(first.id, { pageSize: 20 }),
  ]);

  return {
    hasProject: true,
    hasGeometry: geometry.items.length > 0,
    // Succeeded, not merely started. A queued job that later fails is not a
    // first run somebody completed, and ticking it would be the checklist
    // telling them they are done at the moment they are not.
    hasRun: simulations.items.some((item) => item.status === "succeeded"),
    firstProjectId: first.id,
  };
}

export function FirstRunChecklist() {
  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    readProgress()
      .then(setProgress)
      // Silent. This is an aid, not the product: a failure to read it must not
      // put an error banner over a dashboard that works.
      .catch(() => setProgress(null));
  }, []);

  if (!progress || progress.hasRun) return null;

  const steps = [
    {
      done: progress.hasProject,
      label: "Create a project",
      detail: "A project holds a part and every run against it.",
      href: "/dashboard/projects",
      cta: "New project",
    },
    {
      done: progress.hasGeometry,
      label: "Upload a CAD file",
      detail: "STEP or STL. It is stored as a version, so a run can name which one it used.",
      href: progress.firstProjectId ? `/dashboard/projects/${progress.firstProjectId}` : null,
      cta: "Upload",
    },
    {
      done: false,
      label: "Run a linear-static solve",
      detail:
        "Say how the part is held and pushed, then read the stress. Units are mm-N-MPa and nothing is converted on the way.",
      href: progress.firstProjectId
        ? `/dashboard/projects/${progress.firstProjectId}/simulate`
        : null,
      cta: "Set up a run",
    },
  ];

  const next = steps.find((step) => !step.done);

  return (
    <section
      aria-labelledby="first-run-heading"
      className="rounded-lg border border-border bg-surface p-5 shadow-card"
    >
      <h2 id="first-run-heading" className="font-medium">
        Your first stress number
      </h2>
      <p className="mt-1 text-sm text-muted">
        Three steps, about ten minutes, on the free tier.{" "}
        <Link href="/docs" className="underline underline-offset-2">
          The long version is in the guides.
        </Link>
      </p>

      <ol className="mt-4 space-y-3">
        {steps.map((step) => (
          <li key={step.label} className="flex items-start gap-3">
            <span
              aria-hidden
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs ${
                step.done ? "bg-success/15 text-success" : "bg-canvas text-faint"
              }`}
            >
              {step.done ? "✓" : "·"}
            </span>
            <div>
              <p className={`text-sm ${step.done ? "text-muted line-through" : ""}`}>
                {step.label}
                <span className="sr-only">{step.done ? " — done" : " — not done yet"}</span>
              </p>
              {!step.done && <p className="mt-0.5 text-xs text-muted">{step.detail}</p>}
            </div>
            {step === next && step.href && (
              <Link
                href={step.href}
                className="ml-auto shrink-0 rounded-full border border-border-strong px-3 py-1 text-xs hover:bg-canvas"
              >
                {step.cta}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
