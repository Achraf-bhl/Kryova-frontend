"use client";

import { useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api-client";
import {
  DEFAULT_KERNEL_RENDER,
  KERNEL_SECTIONS,
  KERNEL_VIEWS,
  describeKernelView,
  kernelRenderPath,
  kernelViewLabel,
  type KernelPartState,
  type KernelRenderRequest,
} from "@/lib/kernel-render";

/**
 * The part the open kernel is building, drawn beside the conversation.
 *
 * The OCCT half of the rule the CATIA path already satisfies: a tool result
 * that says `ok` is not evidence the geometry is right, so somebody has to
 * look. On a seat that is `catia_capture_view` and `components/tool-image.tsx`.
 * Here there is no capture to show — the geometry is in the API process — so
 * this asks the render endpoint for it.
 *
 * **It is pinned to the live state and not to a turn**, because the endpoint has
 * no history: it draws the document as it stands. See `lib/kernel-render.ts` for
 * why that rules out putting it in the transcript.
 *
 * Nothing here claims a picture exists. Every way this can fail to produce one
 * — the fetch refused, the bytes were not an image, the browser would not
 * decode them, the part was evicted — says so in words. Silence would read
 * exactly like a part that was never built, which is the one reading that must
 * never be available.
 */

type Loaded =
  | { kind: "loading" }
  | { kind: "ready"; url: string; blank: boolean }
  | { kind: "not-image"; type: string }
  | { kind: "failed"; message: string };

export interface KernelPartViewProps {
  conversationId: string;
  state: KernelPartState;
  /**
   * Bumped by the caller whenever the part may have moved — in practice once
   * per finished turn. Not a timer: the geometry changes when the agent acts,
   * and polling would spend requests asking an unchanged part to redraw.
   */
  revision: number;
}

export function KernelPartView({ conversationId, state, revision }: KernelPartViewProps) {
  const [request, setRequest] = useState<KernelRenderRequest>(DEFAULT_KERNEL_RENDER);
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [open, setOpen] = useState(true);

  const ready = state.kind === "ready";
  const path = kernelRenderPath(conversationId, request);
  const description = describeKernelView(request);

  useEffect(() => {
    if (!ready || !open) return;

    let cancelled = false;
    let objectUrl: string | null = null;

    api
      .kernelRender(path)
      .then(({ blob, blank }) => {
        if (cancelled) return;
        const type = blob.type || "";
        if (!type.toLowerCase().startsWith("image/")) {
          setLoaded({ kind: "not-image", type });
          return;
        }
        try {
          objectUrl = URL.createObjectURL(blob);
        } catch {
          setLoaded({ kind: "failed", message: "This browser would not open the drawing." });
          return;
        }
        // An empty frame is a valid PNG and looks exactly like a successful
        // render of a part that falls outside this view, so it has to be said.
        // `blank` is the renderer's own answer rather than an inference from
        // the byte count — see `api.kernelRender`.
        setLoaded({ kind: "ready", url: objectUrl, blank });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoaded({
          kind: "failed",
          message:
            error instanceof ApiError
              ? error.message
              : "The part could not be drawn by the server.",
        });
      });

    return () => {
      cancelled = true;
      // Held by the document until revoked, so a session that renders after
      // every turn would otherwise pin every picture it ever drew.
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
    // `revision` is a dependency with no use in the body on purpose: it is the
    // caller saying "the geometry may have moved", which is the only reason to
    // ask for the same URL again.
  }, [path, ready, open, revision]);

  if (state.kind === "absent" || state.kind === "waiting") return null;

  if (state.kind === "evicted") {
    return (
      <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
        The part this conversation was building is no longer in memory — too many were open at
        once and this one was closed. Nothing was saved. Ask for it again and it will rebuild.
      </div>
    );
  }

  return (
    <section className="rounded-md border border-border bg-surface" aria-label="The part so far">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-xs font-medium text-accent"
        >
          <span
            className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          >
            ›
          </span>
          The part so far
        </button>
        {state.documentName && (
          <span className="truncate font-mono text-[0.6875rem] text-faint">
            {state.documentName}
          </span>
        )}
        {/* Which kernel drew it. A picture is bound to what produced it, the
            same way a measurement is — and on this backend the answer is not
            the one the CATIA chip beside it implies. */}
        <span className="ml-auto shrink-0 font-mono text-[0.6875rem] text-faint">
          {state.backendVersion}
        </span>
      </div>

      {open && (
        <div className="border-t border-border p-3">
          <div className="mb-2 flex flex-wrap items-center gap-1">
            {KERNEL_VIEWS.map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setRequest((r) => ({ ...r, view }))}
                aria-pressed={request.view === view}
                className={`rounded-sm px-1.5 py-0.5 text-[11px] ${
                  request.view === view
                    ? "bg-primary-soft text-blueprint"
                    : "text-muted hover:text-accent"
                }`}
              >
                {kernelViewLabel(view)}
              </button>
            ))}
            <span className="mx-1 h-3 w-px bg-border" aria-hidden />
            {KERNEL_SECTIONS.map((axis) => (
              <button
                key={axis}
                type="button"
                onClick={() =>
                  setRequest((r) => ({ ...r, section: r.section === axis ? null : axis }))
                }
                aria-pressed={request.section === axis}
                // A wireframe cannot show an internal feature: a bore reads as
                // two dashed lines and a pocket reads as nothing at all. This
                // is the only way to see one, so it is a control and not a
                // debugging aid.
                title={`Cut through the middle of ${axis.toUpperCase()}`}
                className={`rounded-sm px-1.5 py-0.5 text-[11px] ${
                  request.section === axis
                    ? "bg-primary-soft text-blueprint"
                    : "text-muted hover:text-accent"
                }`}
              >
                Cut {axis.toUpperCase()}
              </button>
            ))}
          </div>

          {loaded.kind === "ready" ? (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element -- a blob:
                  URL from the authenticated transport; next/image needs a
                  loader and intrinsic dimensions and has neither here. */}
              <img
                src={loaded.url}
                alt={description}
                onError={() =>
                  setLoaded({
                    kind: "failed",
                    message: "The browser could not decode that drawing.",
                  })
                }
                className="max-h-80 w-auto max-w-full rounded-sm border border-border bg-canvas-deep"
              />
              <figcaption className="mt-1 text-[11px] text-muted">
                {loaded.blank
                  ? `${description} — the frame came back empty, so nothing in the part falls in this view.`
                  : description}
              </figcaption>
            </figure>
          ) : loaded.kind === "not-image" ? (
            <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-xs text-muted">
              The server returned {loaded.type || "a response with no declared type"}, which is
              not a drawing this browser can show.
            </p>
          ) : loaded.kind === "failed" ? (
            <p className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
              {loaded.message}
            </p>
          ) : (
            <div
              className="h-40 w-full animate-pulse rounded-sm border border-border bg-surface-sunken"
              role="status"
              aria-label={`Drawing the ${description.toLowerCase()}`}
            />
          )}
        </div>
      )}
    </section>
  );
}
