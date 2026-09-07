"use client";

import { useEffect, useRef, useState } from "react";

import { ApiError, api } from "@/lib/api-client";
import { describeToolImage, type ToolImage as ToolImageDescriptor } from "@/lib/tool-media";
import { formatBytes } from "@/lib/format";

/**
 * A picture a tool produced, rendered in the transcript.
 *
 * The backend's standing rule is that every CATIA result is screenshotted and
 * the screenshot is *looked at* — and the product itself could not show one
 * until this existed. So the image is rendered in the step row unconditionally,
 * not behind the expander: a picture nobody opens is the same as no picture,
 * and hiding it one click deep would have satisfied the letter of the rule and
 * none of the point. The raw JSON stays behind the expander where it was.
 *
 * Nothing here asserts that a result *is* an image. `toolImageFrom` says a
 * result points at a media object that might be one; this fetches the bytes and
 * renders an `<img>` only when the blob's own MIME type says `image/*`. Every
 * other outcome — the fetch failed, the file is not an image, the browser could
 * not decode it — says so in words. None of them silently render nothing, which
 * would read exactly like a capture that was never taken.
 */

type Loaded =
  | { kind: "loading" }
  | { kind: "ready"; url: string; type: string }
  | { kind: "not-image"; type: string }
  | { kind: "failed"; message: string };

/**
 * Whether the element is close enough to the viewport to be worth fetching.
 *
 * Rehydrating a long conversation mounts every step it ever ran at once, and a
 * verification session takes a lot of captures — so loading all of them on
 * mount would pull tens of megabytes for pictures scrolled a thousand pixels
 * off screen. `IntersectionObserver` is in every browser this app targets;
 * where it is missing (jsdom, an old webview) the answer is an immediate
 * `true`, because a picture that loads eagerly is a waste and a picture that
 * never loads is a bug.
 */
function useNearViewport<T extends Element>(ref: React.RefObject<T | null>): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (near) return;
    const element = ref.current;
    if (element === null || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      // Start the fetch before it is on screen, so scrolling to a capture finds
      // it drawn rather than loading.
      { rootMargin: "600px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, ref]);

  return near;
}

export function ToolImage({ image }: { image: ToolImageDescriptor }) {
  // Starts loading and is only ever moved from a callback. A synchronous
  // `setState` in the effect body is a cascading render (and React's own lint
  // rule refuses it), so the *reset* between two different captures is done by
  // remounting instead — see the `key` at the call site in `agent-step-list`.
  const [state, setState] = useState<Loaded>({ kind: "loading" });
  const [full, setFull] = useState(false);
  const frame = useRef<HTMLDivElement | null>(null);
  const near = useNearViewport(frame);
  const description = describeToolImage(image);

  useEffect(() => {
    // `tooLarge` is offered rather than loaded — see MAX_INLINE_IMAGE_BYTES.
    if (image.tooLarge || !near) return;

    let cancelled = false;
    let objectUrl: string | null = null;

    api
      .mediaBlob(image.mediaId)
      .then((blob) => {
        if (cancelled) return;
        const type = blob.type || "";
        if (!type.toLowerCase().startsWith("image/")) {
          setState({ kind: "not-image", type });
          return;
        }
        try {
          objectUrl = URL.createObjectURL(blob);
        } catch {
          setState({ kind: "failed", message: "This browser would not open the file." });
          return;
        }
        setState({ kind: "ready", url: objectUrl, type });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          kind: "failed",
          message:
            error instanceof ApiError
              ? error.message
              : "The view could not be fetched from the server.",
        });
      });

    return () => {
      cancelled = true;
      // Object URLs are held by the document until revoked, so a transcript
      // that has scrolled past fifty captures would otherwise pin every one of
      // them in memory for the life of the tab.
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [image.mediaId, image.tooLarge, near]);

  const caption = (
    <figcaption className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted">
      <span>{description}</span>
      {image.widthPx !== null && image.heightPx !== null && (
        <span className="tabular-nums">
          {image.widthPx} × {image.heightPx} px
        </span>
      )}
      {image.sizeBytes !== null && (
        <span className="tabular-nums">{formatBytes(image.sizeBytes)}</span>
      )}
    </figcaption>
  );

  return (
    <figure ref={frame} className="my-2">
      {image.tooLarge ? (
        <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-xs text-muted">
          That file is {image.sizeBytes !== null ? formatBytes(image.sizeBytes) : "very large"},
          which is past what this view will pull into the page. Open it from the Files page
          instead.
        </p>
      ) : state.kind === "ready" ? (
        <button
          type="button"
          onClick={() => setFull((v) => !v)}
          aria-pressed={full}
          title={full ? "Fit to the conversation" : "Show at full size"}
          className={`block max-w-full overflow-auto rounded-md border border-border bg-canvas-deep p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
            full ? "max-h-[36rem] cursor-zoom-out" : "cursor-zoom-in"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL
              from the authenticated media transport, whose pixel size the real
              seat does not report; next/image needs a loader and intrinsic
              dimensions, and has neither here. */}
          <img
            src={state.url}
            alt={description}
            onError={() =>
              setState({
                kind: "failed",
                message: "The browser could not decode that image.",
              })
            }
            className={full ? "max-w-none" : "max-h-72 w-auto max-w-full"}
          />
        </button>
      ) : state.kind === "not-image" ? (
        <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-xs text-muted">
          The seat returned {state.type || "a file with no declared type"}, which is not an image
          this browser can show. The bytes are stored and intact; only the preview is missing.
        </p>
      ) : state.kind === "failed" ? (
        <p className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
          {state.message}
        </p>
      ) : (
        <div
          className="h-24 w-40 animate-pulse rounded-md border border-border bg-surface-sunken"
          role="status"
          aria-label={`Loading ${description}`}
        />
      )}
      {caption}
    </figure>
  );
}
