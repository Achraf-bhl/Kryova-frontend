/**
 * Looking at the part the open kernel is building.
 *
 * The other half of `lib/tool-media.ts`. On a CATIA seat the agent calls
 * `catia_capture_view`, the result carries a `media_id`, and the transcript
 * draws it — that path has worked since the picture rule was finally satisfied.
 * On `GEOMETRY_BACKEND=occt` there is no seat, no screenshot and no media id:
 * the geometry lives in the API process and the only way to see it is
 * `GET /kernel/conversations/{id}/render`, which had no caller in this repo at
 * all. So an agent driving the open kernel built parts that nobody using the
 * product could see, which is the same defect the CATIA half was written to fix,
 * reached from the other side.
 *
 * **The endpoint answers "what does the part look like now", not "what did it
 * look like then"** — there is no render history, and the in-process document
 * is whatever the last call left. That single fact decides the whole design:
 *
 * * A picture pinned beside the *live* state is honest. A picture placed in the
 *   transcript next to turn 3 would redraw itself into turn 9's part on the next
 *   build, silently, and a transcript that rewrites its own evidence is worse
 *   than one with no pictures in it.
 * * It follows that there is exactly one of these per conversation, and it does
 *   not belong to any turn.
 *
 * Nothing here fetches. This module is the vocabulary and the decision; the
 * request lives in `api-client.ts` and the pixels in
 * `components/kernel-part-view.tsx`, so all of the reasoning below is testable
 * without a network or a DOM.
 */

import { localKernelOf, type CatiaStatus } from "@/types/catia";

/**
 * The cameras `app/render/views.py::ALL_VIEWS` serves, in its order —
 * orthographic first, then the two isometrics.
 *
 * Hand-mirrored like every other type in this repo, and the failure mode is
 * mild by construction: a name this list has and the backend does not comes
 * back as a 400 naming the real ones, rather than a wrong picture.
 */
export const KERNEL_VIEWS = [
  "front",
  "back",
  "left",
  "right",
  "top",
  "bottom",
  "iso",
  "iso_rear",
] as const;

export type KernelView = (typeof KERNEL_VIEWS)[number];

/** Axes `?section=` cuts through the middle of before drawing. */
export const KERNEL_SECTIONS = ["x", "y", "z"] as const;

export type KernelSection = (typeof KERNEL_SECTIONS)[number];

export const DEFAULT_KERNEL_VIEW: KernelView = "iso";

export interface KernelRenderRequest {
  view: KernelView;
  /** Null draws the part whole; an axis cuts it in half and hatches the cut. */
  section: KernelSection | null;
  width: number;
  height: number;
}

/**
 * Canvas defaults.
 *
 * Well inside the endpoint's own 128–4096 bounds, and chosen for a panel beside
 * a conversation rather than for a drawing sheet: this is a check that the part
 * is the shape the user asked for, and it is one request per finished turn.
 */
export const DEFAULT_KERNEL_RENDER: KernelRenderRequest = {
  view: DEFAULT_KERNEL_VIEW,
  section: null,
  width: 1024,
  height: 768,
};

/**
 * The API path for one render, relative to the client's base URL.
 *
 * Every parameter is always written, including the defaults. The URL is the
 * cache key the browser revalidates against the endpoint's ETag, and a request
 * that sometimes omits `view=iso` and sometimes writes it is two cache entries
 * for one picture.
 */
export function kernelRenderPath(
  conversationId: string,
  request: KernelRenderRequest = DEFAULT_KERNEL_RENDER,
): string {
  const query = new URLSearchParams({
    view: request.view,
    width: String(request.width),
    height: String(request.height),
  });
  if (request.section !== null) query.set("section", request.section);
  return `/kernel/conversations/${encodeURIComponent(conversationId)}/render?${query.toString()}`;
}

/**
 * What the panel should be doing, read off the status the chat already polls.
 *
 * Deliberately decided from `GET /catia/status` rather than by firing the
 * render and reading its refusal. The endpoint answers three different 409s —
 * wrong backend, evicted, nothing built — and telling them apart would mean
 * matching on English prose that exists to be read by a person. The status call
 * carries the same three facts as data, the chat is already making it once per
 * conversation, and it costs nothing to ask it a second question.
 *
 * * `absent` — a seat builds here, or CATIA integration is off entirely. Show
 *   nothing at all: the CATIA path has its own pictures and a second empty
 *   frame beside them is furniture.
 * * `waiting` — the open kernel is live and nothing has been built yet. Also
 *   nothing on screen; there is no part, and a placeholder claiming otherwise is
 *   the thing this whole module exists to avoid.
 * * `evicted` — the part was dropped to bound memory. This one is *said*, in
 *   words, because it is a real loss the user has to know about: nothing was
 *   saved and the part is not coming back.
 * * `ready` — draw it.
 */
export type KernelPartState =
  | { kind: "absent" }
  | { kind: "waiting" }
  | { kind: "evicted" }
  | { kind: "ready"; documentName: string | null; backendVersion: string };

export function kernelPartState(
  status: CatiaStatus | null,
  conversationId: string | null,
): KernelPartState {
  if (conversationId === null) return { kind: "absent" };

  const kernel = localKernelOf(status);
  if (kernel === null || !kernel.enabled) return { kind: "absent" };

  const document = kernel.document;
  if (document === null) return { kind: "waiting" };
  if (document.evicted) return { kind: "evicted" };

  return {
    kind: "ready",
    documentName: document.doc_name,
    backendVersion: kernel.backend_version,
  };
}

/**
 * What the picture is of, for the caption and for the `alt` text.
 *
 * A screen reader gets this instead of the image, so it says what the image is
 * *of* and never describes the geometry — nothing on this side has looked at
 * the pixels, which is the same rule `describeToolImage` follows for a seat
 * capture.
 */
export function describeKernelView(request: KernelRenderRequest): string {
  const view = request.view === "iso_rear" ? "Rear isometric" : capitalise(request.view);
  return request.section === null
    ? `${view} view of the part`
    : `${view} view, cut through the middle of ${request.section.toUpperCase()}`;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * A label for one view in the picker.
 *
 * `iso_rear` is the only name that does not read as English, and spelling it
 * "Iso rear" would be a third spelling of a thing that already has two.
 */
export function kernelViewLabel(view: KernelView): string {
  return view === "iso_rear" ? "Iso (rear)" : capitalise(view);
}
