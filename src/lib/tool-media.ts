/**
 * Finding the picture in a tool result.
 *
 * The backend's own rule is that "a tool result that says `ok` is not evidence
 * the geometry is right" — a feature that succeeded but produced the wrong
 * shape looks identical to one that worked in every field of the payload. So
 * `catia_capture_view` exists, and the whole product is built on somebody
 * *looking* at what it returns. Until now the chat rendered that return as
 * `JSON.stringify(result)`: a media id, a view name and a byte count. The one
 * artefact the rule is about was the one thing the UI could not show.
 *
 * The shape it comes back as, from `app/catia/dispatch.py::_store_capture`:
 *
 * ```json
 * { "media_id": "…", "view": "iso", "label": "", "width_px": null,
 *   "height_px": null, "size_bytes": 148213 }
 * ```
 *
 * Note the nulls, and do not build on them. `width_px`/`height_px` are only
 * ever populated by the *mock* daemon (`scripts/catia_bridge/mock_catia.py`);
 * the real seat's `capture_view` returns `filename`/`view`/`size_bytes`/`sha256`
 * and no dimensions at all, and `_store_capture` does not put `filename` or
 * `content_type` in what the agent sees. A detector keyed on the pixel
 * dimensions would therefore work perfectly against the mock and show nothing
 * on the machine with CATIA on it.
 *
 * Which is why this module only ever claims a result *might* carry a picture.
 * The claim is settled by measurement, not by the shape of the JSON:
 * `components/tool-image.tsx` fetches the bytes and renders an `<img>` only
 * once the blob's own MIME type says `image/*`. That keeps the honesty rule the
 * backend applies to an unmeasured assertion — an unverified guess is not a
 * pass — on this side of the wire too.
 */

/**
 * How large a media object may be before the chat stops pulling it into the
 * page automatically.
 *
 * A CATIA JPEG capture is 50–400 kB, so this is not a limit any real screenshot
 * meets. It is a floor under the *detector*: `media_id` is a generic field and
 * another tool could one day return one pointing at a 400 MB STEP file. The
 * blob has to be held whole in memory to become an object URL, so the cost of
 * being wrong is a tab that dies rather than a picture that fails to appear.
 */
export const MAX_INLINE_IMAGE_BYTES = 24 * 1024 * 1024;

/** A media object a tool result points at, which is plausibly a raster image. */
export interface ToolImage {
  mediaId: string;
  /** `iso`, `front`, `top`… — the camera the seat was put on, when it said. */
  view: string | null;
  /** The caption the agent asked for, when it asked for one. */
  label: string | null;
  widthPx: number | null;
  heightPx: number | null;
  sizeBytes: number | null;
  /** Known to be past {@link MAX_INLINE_IMAGE_BYTES}; the UI offers, not loads. */
  tooLarge: boolean;
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|tiff?|avif)$/i;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The media object a tool result points at, if it looks like one worth showing.
 *
 * Deliberately generous about *which* tool: nothing here mentions
 * `catia_capture_view` by name, so a render or an export that later returns a
 * `media_id` for an image is displayed without this file changing. Deliberately
 * strict about the corroboration: a bare `media_id` is not enough, because
 * `catia_checkpoint`'s payload is a media object too and a document snapshot is
 * not a picture of anything.
 */
export function toolImageFrom(result: unknown): ToolImage | null {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return null;
  const record = result as Record<string, unknown>;

  const mediaId = text(record.media_id);
  if (mediaId === null) return null;

  const contentType = text(record.content_type);
  const filename = text(record.filename);
  const widthPx = count(record.width_px);
  const heightPx = count(record.height_px);
  const view = text(record.view);

  const looksRaster =
    contentType?.toLowerCase().startsWith("image/") === true ||
    (filename !== null && IMAGE_EXTENSIONS.test(filename)) ||
    (widthPx !== null && heightPx !== null) ||
    view !== null;
  if (!looksRaster) return null;

  const sizeBytes = count(record.size_bytes);
  return {
    mediaId,
    view,
    label: text(record.label),
    widthPx,
    heightPx,
    sizeBytes,
    tooLarge: sizeBytes !== null && sizeBytes > MAX_INLINE_IMAGE_BYTES,
  };
}

/**
 * What to call the picture, for the caption and for the `alt` text.
 *
 * A screen reader gets this instead of the image, so it says what the image is
 * *of* rather than that an image exists. It never invents a description of the
 * geometry — nothing on this side has looked at the pixels.
 */
export function describeToolImage(image: ToolImage): string {
  const parts = [image.view ? `${image.view} view` : "Captured view"];
  if (image.label) parts.push(image.label);
  return parts.join(" — ");
}
