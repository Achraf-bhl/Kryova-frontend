import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mediaBlob = vi.fn();

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, api: { mediaBlob } };
});

const { ToolImage } = await import("./tool-image");
const { toolImageFrom } = await import("@/lib/tool-media");

/** The real seat's payload: a media id, a camera, a byte count, nothing else. */
function capture(overrides: Record<string, unknown> = {}) {
  return toolImageFrom({
    media_id: "med_7f3a",
    view: "iso",
    label: "",
    width_px: null,
    height_px: null,
    size_bytes: 148213,
    ...overrides,
  })!;
}

const created: string[] = [];
const revoked: string[] = [];

/**
 * Patched onto the real `URL` rather than replacing it: `{...URL}` would drop
 * the constructor, and anything that does `new URL(...)` — including Next's own
 * helpers — would start throwing for reasons nothing in the failure names.
 */
type ObjectUrlApi = {
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
};
let originalCreate: ObjectUrlApi["createObjectURL"];
let originalRevoke: ObjectUrlApi["revokeObjectURL"];

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  const target = URL as unknown as ObjectUrlApi;
  originalCreate = target.createObjectURL;
  originalRevoke = target.revokeObjectURL;
  target.createObjectURL = (blob: Blob) => {
    const url = `blob:mock/${created.length}-${blob.type}`;
    created.push(url);
    return url;
  };
  target.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
});

afterEach(() => {
  const target = URL as unknown as ObjectUrlApi;
  target.createObjectURL = originalCreate;
  target.revokeObjectURL = originalRevoke;
  mediaBlob.mockReset();
  vi.unstubAllGlobals();
});

describe("ToolImage", () => {
  it("renders the fetched bytes as a picture once they arrive", async () => {
    mediaBlob.mockResolvedValue(new Blob(["jpegbytes"], { type: "image/jpeg" }));

    render(<ToolImage image={capture()} />);

    const img = await screen.findByRole("img", { name: "iso view" });
    expect(img).toHaveAttribute("src", expect.stringContaining("blob:mock/"));
    expect(mediaBlob).toHaveBeenCalledWith("med_7f3a");
  });

  it("labels the picture with the camera and the agent's caption", async () => {
    mediaBlob.mockResolvedValue(new Blob(["x"], { type: "image/png" }));

    render(<ToolImage image={capture({ label: "after the pocket", view: "front" })} />);

    expect(await screen.findByRole("img", { name: "front view — after the pocket" })).toBeInTheDocument();
  });

  it("says the file is not an image rather than showing a blank frame", async () => {
    // The bug this guards: CATIA V5 cannot write a PNG, and the bridge once
    // wrote a greyscale TIFF and named it .png. A viewer that trusts the name
    // renders an empty box and looks exactly like a capture nobody took.
    mediaBlob.mockResolvedValue(new Blob(["II*"], { type: "image/tiff" }));
    const { unmount } = render(<ToolImage image={capture()} />);
    // image/tiff *is* image/*, so it is offered to the browser — the honest
    // refusal below is for a payload that is not an image at all.
    expect(await screen.findByRole("img")).toBeInTheDocument();
    unmount();

    mediaBlob.mockResolvedValue(new Blob(["ISO-10303-21;"], { type: "application/step" }));
    render(<ToolImage image={capture()} />);

    expect(await screen.findByText(/not an image this browser can show/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("surfaces the backend's own message when the fetch fails", async () => {
    const { ApiError } = await vi.importActual<typeof import("@/lib/api-client")>(
      "@/lib/api-client",
    );
    mediaBlob.mockRejectedValue(new ApiError(410, "File is no longer on disk"));

    render(<ToolImage image={capture()} />);

    expect(await screen.findByText("File is no longer on disk")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("reports a decode failure instead of leaving a broken-image icon", async () => {
    mediaBlob.mockResolvedValue(new Blob(["truncated"], { type: "image/jpeg" }));

    render(<ToolImage image={capture()} />);

    const img = await screen.findByRole("img");
    fireEvent.error(img);

    expect(await screen.findByText(/could not decode that image/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("offers rather than loads a media object too large for the page", async () => {
    render(<ToolImage image={capture({ size_bytes: 400 * 1024 * 1024 })} />);

    expect(screen.getByText(/past what this view will pull into the page/)).toBeInTheDocument();
    expect(mediaBlob).not.toHaveBeenCalled();
  });

  it("toggles between fitted and full size on click", async () => {
    mediaBlob.mockResolvedValue(new Blob(["x"], { type: "image/png" }));
    const user = userEvent.setup();

    render(<ToolImage image={capture()} />);
    const img = await screen.findByRole("img");
    expect(img.className).toContain("max-h-72");

    await user.click(screen.getByRole("button"));
    expect((await screen.findByRole("img")).className).toContain("max-w-none");
  });

  it("releases the object URL when the transcript unmounts it", async () => {
    mediaBlob.mockResolvedValue(new Blob(["x"], { type: "image/png" }));

    const { unmount } = render(<ToolImage image={capture()} />);
    await screen.findByRole("img");
    expect(created).toHaveLength(1);

    unmount();
    expect(revoked).toEqual(created);
  });

  it("waits for the row to come near the viewport before fetching", async () => {
    // Rehydrating a long conversation mounts every capture it ever took. With
    // an observer present nothing is fetched until it says so.
    const observers: Array<(entries: { isIntersecting: boolean }[]) => void> = [];
    class FakeObserver {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    mediaBlob.mockResolvedValue(new Blob(["x"], { type: "image/png" }));

    render(<ToolImage image={capture()} />);
    expect(mediaBlob).not.toHaveBeenCalled();

    observers[0]([{ isIntersecting: true }]);
    await waitFor(() => expect(mediaBlob).toHaveBeenCalledTimes(1));
  });
});
