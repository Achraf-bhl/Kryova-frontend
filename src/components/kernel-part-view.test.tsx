import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const kernelRender = vi.fn();

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return { ...actual, api: { kernelRender } };
});

const { KernelPartView } = await import("./kernel-part-view");
const { kernelPartState } = await import("@/lib/kernel-render");

const READY = {
  kind: "ready" as const,
  documentName: "Part",
  backendVersion: "OCCT 7.9.3",
};

function drawn(overrides: { blank?: boolean; type?: string } = {}) {
  return {
    blob: new Blob(["pngbytes"], { type: overrides.type ?? "image/png" }),
    blank: overrides.blank ?? false,
    view: "iso",
  };
}

type ObjectUrlApi = {
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
};
let originalCreate: ObjectUrlApi["createObjectURL"];
let originalRevoke: ObjectUrlApi["revokeObjectURL"];
const revoked: string[] = [];

beforeEach(() => {
  revoked.length = 0;
  const target = URL as unknown as ObjectUrlApi;
  originalCreate = target.createObjectURL;
  originalRevoke = target.revokeObjectURL;
  let n = 0;
  target.createObjectURL = () => `blob:mock/${n++}`;
  target.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
});

afterEach(() => {
  const target = URL as unknown as ObjectUrlApi;
  target.createObjectURL = originalCreate;
  target.revokeObjectURL = originalRevoke;
  kernelRender.mockReset();
});

describe("KernelPartView", () => {
  it("draws the part the open kernel is holding", async () => {
    kernelRender.mockResolvedValue(drawn());

    render(<KernelPartView conversationId="conv_1" state={READY} revision={1} />);

    const image = await screen.findByRole("img");
    expect(image).toHaveAttribute("alt", "Iso view of the part");
    expect(kernelRender).toHaveBeenCalledWith(
      "/kernel/conversations/conv_1/render?view=iso&width=1024&height=768",
    );
  });

  it("renders nothing whatever on a CATIA deployment", () => {
    // The whole component has to be invisible when a seat is what builds:
    // that path has its own pictures and this endpoint would 409 at it.
    const { container } = render(
      <KernelPartView conversationId="conv_1" state={{ kind: "absent" }} revision={1} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(kernelRender).not.toHaveBeenCalled();
  });

  it("renders nothing, and asks for nothing, before anything is built", () => {
    const { container } = render(
      <KernelPartView conversationId="conv_1" state={{ kind: "waiting" }} revision={1} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(kernelRender).not.toHaveBeenCalled();
  });

  it("says an evicted part is gone rather than showing an empty frame", async () => {
    render(<KernelPartView conversationId="conv_1" state={{ kind: "evicted" }} revision={1} />);

    expect(screen.getByText(/no longer in memory/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was saved/i)).toBeInTheDocument();
    expect(kernelRender).not.toHaveBeenCalled();
  });

  it("says when the frame came back empty, instead of showing a blank picture silently", async () => {
    // An empty frame is a valid PNG and is indistinguishable from a successful
    // render of a part that falls outside this view. `blank` is the renderer's
    // own answer, read off `X-Kryova-Blank`.
    kernelRender.mockResolvedValue(drawn({ blank: true }));

    render(<KernelPartView conversationId="conv_1" state={READY} revision={1} />);

    expect(await screen.findByText(/the frame came back empty/i)).toBeInTheDocument();
  });

  it("says a render refused, rather than falling silent", async () => {
    const { ApiError } = await import("@/lib/api-client");
    kernelRender.mockRejectedValue(new ApiError(422, "The part could not be drawn: bad shape"));

    render(<KernelPartView conversationId="conv_1" state={READY} revision={1} />);

    // The backend's own message, verbatim: it is written to be read by a
    // person and says what to do about it.
    expect(await screen.findByText(/The part could not be drawn: bad shape/)).toBeInTheDocument();
  });

  it("says so when the bytes are not an image at all", async () => {
    kernelRender.mockResolvedValue(drawn({ type: "application/json" }));

    render(<KernelPartView conversationId="conv_1" state={READY} revision={1} />);

    expect(await screen.findByText(/not a drawing this browser can show/i)).toBeInTheDocument();
  });

  it("asks for the view the user picked", async () => {
    kernelRender.mockResolvedValue(drawn());
    const user = userEvent.setup();

    render(<KernelPartView conversationId="conv_1" state={READY} revision={1} />);
    await screen.findByRole("img");

    await user.click(screen.getByRole("button", { name: "Front" }));

    await waitFor(() =>
      expect(kernelRender).toHaveBeenLastCalledWith(
        "/kernel/conversations/conv_1/render?view=front&width=1024&height=768",
      ),
    );
    expect(screen.getByRole("img")).toHaveAttribute("alt", "Front view of the part");
  });

  it("cuts the part, and cuts it back, from one button", async () => {
    // A wireframe cannot show an internal feature — a bore is two dashed lines
    // and a pocket is nothing — so this is a control, not a debugging aid.
    kernelRender.mockResolvedValue(drawn());
    const user = userEvent.setup();

    render(<KernelPartView conversationId="conv_1" state={READY} revision={1} />);
    await screen.findByRole("img");

    await user.click(screen.getByRole("button", { name: "Cut Z" }));
    await waitFor(() =>
      expect(kernelRender).toHaveBeenLastCalledWith(expect.stringContaining("&section=z")),
    );

    await user.click(screen.getByRole("button", { name: "Cut Z" }));
    await waitFor(() =>
      expect(kernelRender).toHaveBeenLastCalledWith(expect.not.stringContaining("section")),
    );
  });

  it("redraws when the caller says the geometry may have moved", async () => {
    kernelRender.mockResolvedValue(drawn());

    const view = render(<KernelPartView conversationId="conv_1" state={READY} revision={1} />);
    await screen.findByRole("img");
    expect(kernelRender).toHaveBeenCalledTimes(1);

    view.rerender(<KernelPartView conversationId="conv_1" state={READY} revision={2} />);

    // Same URL, asked again on purpose. The render is deterministic, so an
    // unchanged part costs a 304 and no pixels — and a part that did change is
    // the only reason this component exists.
    await waitFor(() => expect(kernelRender).toHaveBeenCalledTimes(2));
  });

  it("revokes the object URL it created, so a long session does not pin every render", async () => {
    kernelRender.mockResolvedValue(drawn());

    const view = render(<KernelPartView conversationId="conv_1" state={READY} revision={1} />);
    await screen.findByRole("img");

    view.unmount();
    await waitFor(() => expect(revoked).toHaveLength(1));
  });

  it("names which kernel drew it", async () => {
    kernelRender.mockResolvedValue(drawn());

    render(<KernelPartView conversationId="conv_1" state={READY} revision={1} />);

    expect(screen.getByText("OCCT 7.9.3")).toBeInTheDocument();
  });

  it("is wired to the state the chat computes, not to a second idea of it", async () => {
    // Guards the seam: `chat-view` decides with `kernelPartState` and this
    // component consumes exactly that. A CATIA status must reach `absent`.
    const seatStatus = {
      connected: true,
      enabled: true,
      backend: "catia",
      paired_devices: 1,
      document: null,
    } as never;

    const { container } = render(
      <KernelPartView
        conversationId="conv_1"
        state={kernelPartState(seatStatus, "conv_1")}
        revision={1}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
