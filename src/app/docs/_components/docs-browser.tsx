"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import type { ApiReference, Guide, MissionGallery } from "@/types/api";

/**
 * The docs site's three surfaces (P10.2).
 *
 * Client-side because all three are public reads with no session, and the page
 * around them is static — nothing here needs a server render, and fetching from
 * the browser keeps `/docs` cacheable at the edge.
 *
 * **`not_covered` and `not_claimed` are rendered, always.** They are the fields
 * that stop documentation becoming marketing, and dropping them would leave the
 * most convincing page in the product also being the least true one. The
 * stop-a-run guide's caveat — that stopping is not a refund — is the one a
 * reader would otherwise get wrong about their own bill.
 */

type Tab = "guides" | "gallery" | "reference";

const TABS: { id: Tab; label: string }[] = [
  { id: "guides", label: "Guides" },
  { id: "gallery", label: "Mission gallery" },
  { id: "reference", label: "API reference" },
];

export function DocsBrowser() {
  const [tab, setTab] = useState<Tab>("guides");

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-2" aria-label="Documentation sections">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              tab === id
                ? "border-border-strong bg-surface text-accent"
                : "border-border text-muted hover:text-accent"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "guides" && <Guides />}
      {tab === "gallery" && <Gallery />}
      {tab === "reference" && <Reference />}
    </div>
  );
}

function Guides() {
  const [guides, setGuides] = useState<Guide[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .listGuides()
      .then((body) => setGuides(body.guides))
      .catch(() => setError(true));
  }, []);

  if (error) return <Unreachable />;
  if (!guides) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-6">
      {guides.map((guide) => (
        <article key={guide.slug} className="rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium">{guide.title}</h2>
          <p className="mt-1 text-sm text-muted">{guide.outcome}</p>

          <ol className="mt-3 space-y-2 text-sm">
            {guide.steps.map((step, index) => (
              <li key={index} className="flex gap-3">
                <span className="mt-0.5 shrink-0 text-xs text-faint">{index + 1}</span>
                <div>
                  <p>{step.text}</p>
                  {step.path && (
                    // Shown because it is checked. A path printed here that the
                    // build does not serve fails `tests/test_docs.py`, which is
                    // what makes it safe to print at all.
                    <p className="mt-0.5 font-mono text-xs text-accent">
                      {step.method} /api/v1{step.path}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>

          {guide.not_covered.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <h3 className="text-xs font-medium text-warning">What this does not cover</h3>
              <ul className="mt-1 space-y-1 text-xs text-muted">
                {guide.not_covered.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function Gallery() {
  const [gallery, setGallery] = useState<MissionGallery | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .missionGallery()
      .then(setGallery)
      .catch(() => setError(true));
  }, []);

  if (error) return <Unreachable />;
  if (!gallery) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-4">
      {/* The headline carries the denominator on purpose: "three missions build"
          invites a reader to supply their own idea of how many there are. */}
      <p className="text-sm">{gallery.headline}</p>

      <ul className="space-y-3">
        {gallery.missions.map((mission) => (
          <li key={mission.rung} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-sm text-accent">{mission.rung}</span>
              <h3 className="font-medium">{mission.title}</h3>
              <span
                className={`ml-auto text-xs ${
                  mission.buildable ? "text-success" : "text-muted"
                }`}
              >
                {mission.buildable
                  ? `${mission.builds} · ${mission.assertions} checks`
                  : "not reachable yet"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">Hard part: {mission.hard}</p>

            {mission.not_claimed.length > 0 && (
              <div className="mt-2">
                {/* The half that makes this a gallery and not a brochure. A rung
                    that passes is not a machine that is finished. */}
                <p className="text-xs font-medium text-warning">This does not claim</p>
                <ul className="mt-0.5 space-y-0.5 text-xs text-muted">
                  {mission.not_claimed.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}

            {mission.waiting_on.length > 0 && (
              <p className="mt-2 text-xs text-muted">
                Waiting on: {mission.waiting_on.join(", ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Reference() {
  const [reference, setReference] = useState<ApiReference | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .apiReference()
      .then(setReference)
      .catch(() => setError(true));
  }, []);

  if (error) return <Unreachable />;
  if (!reference) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {reference.operation_count} operations, {reference.public_operation_count} of
        them readable without an account. {reference.note}
      </p>

      {reference.groups.map((group) => (
        <details key={group.tag} className="rounded-lg border border-border bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            {group.tag}{" "}
            <span className="text-muted">({group.operations.length})</span>
          </summary>
          {/* Wide content scrolls inside its own box rather than pushing the
              page sideways on a phone. */}
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-left text-xs">
              <tbody>
                {group.operations.map((operation) => (
                  <tr
                    key={`${operation.method}-${operation.path}`}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-accent">
                      {operation.method}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 font-mono">{operation.path}</td>
                    <td className="px-2 py-2 text-muted">{operation.summary}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-faint">
                      {/* Authenticated routes are marked, not hidden: somebody
                          deciding whether this fits needs the whole shape. */}
                      {operation.public ? "public" : "sign in"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}

function Unreachable() {
  return (
    <p role="alert" className="text-sm text-danger">
      The documentation could not be loaded — the API did not answer. The{" "}
      <a href="/status" className="underline underline-offset-2">
        status page
      </a>{" "}
      may say why.
    </p>
  );
}
