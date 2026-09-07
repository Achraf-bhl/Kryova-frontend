import { describe, expect, it } from "vitest";

import { MAX_INLINE_IMAGE_BYTES, describeToolImage, toolImageFrom } from "./tool-media";

/**
 * What `catia_capture_view` returns from a **real** seat, byte for byte in
 * shape: no `width_px`, no `height_px`, no `filename`, no `content_type`.
 * `app/catia/dispatch.py::_store_capture` copies those dimensions from the
 * daemon payload, and only the mock daemon ever sets them.
 *
 * This fixture is the regression: a detector written against the mock passes
 * every test and shows nothing on the machine with CATIA on it.
 */
const REAL_SEAT_CAPTURE = {
  media_id: "med_7f3a",
  view: "iso",
  label: "",
  width_px: null,
  height_px: null,
  size_bytes: 148213,
};

/** What the mock daemon returns — dimensions present. */
const MOCK_CAPTURE = {
  media_id: "med_mock",
  view: "front",
  label: "after the pocket",
  width_px: 1200,
  height_px: 800,
  size_bytes: 24096,
};

describe("toolImageFrom", () => {
  it("finds the capture a real CATIA seat returns, which reports no dimensions", () => {
    const image = toolImageFrom(REAL_SEAT_CAPTURE);
    expect(image).not.toBeNull();
    expect(image?.mediaId).toBe("med_7f3a");
    expect(image?.view).toBe("iso");
    expect(image?.widthPx).toBeNull();
    expect(image?.heightPx).toBeNull();
    expect(image?.sizeBytes).toBe(148213);
    expect(image?.tooLarge).toBe(false);
  });

  it("keeps the dimensions and the label when the payload carries them", () => {
    const image = toolImageFrom(MOCK_CAPTURE);
    expect(image?.widthPx).toBe(1200);
    expect(image?.heightPx).toBe(800);
    expect(image?.label).toBe("after the pocket");
  });

  it("treats an empty label as no label rather than as a caption", () => {
    expect(toolImageFrom(REAL_SEAT_CAPTURE)?.label).toBeNull();
    expect(toolImageFrom({ ...REAL_SEAT_CAPTURE, label: "   " })?.label).toBeNull();
  });

  it("accepts a media object declared as an image, whatever tool produced it", () => {
    expect(toolImageFrom({ media_id: "m", content_type: "image/png" })).not.toBeNull();
    expect(toolImageFrom({ media_id: "m", content_type: "IMAGE/JPEG" })).not.toBeNull();
    expect(toolImageFrom({ media_id: "m", filename: "render-top.PNG" })).not.toBeNull();
  });

  it("refuses a media object with nothing raster about it", () => {
    // catia_checkpoint's payload is a media object too, and a document
    // snapshot is not a picture of anything.
    expect(
      toolImageFrom({ media_id: "m", checkpoint_id: "c1", label: null, size_bytes: 900 }),
    ).toBeNull();
    expect(toolImageFrom({ media_id: "m", filename: "bracket.stp" })).toBeNull();
    expect(toolImageFrom({ media_id: "m", content_type: "application/step" })).toBeNull();
  });

  it("refuses anything that is not a media-bearing object", () => {
    expect(toolImageFrom(undefined)).toBeNull();
    expect(toolImageFrom(null)).toBeNull();
    expect(toolImageFrom("iso")).toBeNull();
    expect(toolImageFrom(42)).toBeNull();
    expect(toolImageFrom([{ media_id: "m", view: "iso" }])).toBeNull();
    expect(toolImageFrom({ view: "iso", size_bytes: 10 })).toBeNull();
    expect(toolImageFrom({ media_id: "", view: "iso" })).toBeNull();
    expect(toolImageFrom({ media_id: 17, view: "iso" })).toBeNull();
  });

  it("ignores a non-numeric size rather than treating it as a limit", () => {
    const image = toolImageFrom({ ...REAL_SEAT_CAPTURE, size_bytes: "148213" });
    expect(image?.sizeBytes).toBeNull();
    expect(image?.tooLarge).toBe(false);
  });

  it("flags a media object too large to pull into the page", () => {
    const image = toolImageFrom({
      media_id: "m",
      view: "iso",
      size_bytes: MAX_INLINE_IMAGE_BYTES + 1,
    });
    expect(image?.tooLarge).toBe(true);
    expect(toolImageFrom({ media_id: "m", view: "iso", size_bytes: MAX_INLINE_IMAGE_BYTES })
      ?.tooLarge).toBe(false);
  });
});

describe("describeToolImage", () => {
  it("names the camera, because that is all this side actually knows", () => {
    expect(describeToolImage(toolImageFrom(REAL_SEAT_CAPTURE)!)).toBe("iso view");
  });

  it("carries the agent's own caption when there is one", () => {
    expect(describeToolImage(toolImageFrom(MOCK_CAPTURE)!)).toBe(
      "front view — after the pocket",
    );
  });

  it("does not invent a view name it was not given", () => {
    const image = toolImageFrom({ media_id: "m", content_type: "image/png" })!;
    expect(describeToolImage(image)).toBe("Captured view");
  });
});
