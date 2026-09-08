import { describe, expect, it } from "vitest";

import {
  DEFAULT_KERNEL_RENDER,
  KERNEL_VIEWS,
  describeKernelView,
  kernelPartState,
  kernelRenderPath,
  kernelViewLabel,
  type KernelView,
} from "./kernel-render";
import type { CatiaStatus } from "@/types/catia";

/** `GET /catia/status` on `GEOMETRY_BACKEND=occt`, as the backend sends it. */
function openKernel(overrides: Partial<CatiaStatus> = {}): CatiaStatus {
  return {
    connected: true,
    enabled: true,
    backend: "occt",
    backend_version: "OCCT 7.9.3",
    paired_devices: 0,
    operations_implemented: 116,
    operations_declared: 201,
    open_documents: 1,
    document: { doc_name: "Part", evicted: false },
    detail: "Geometry is being built by the open kernel in this process.",
    ...overrides,
  } as CatiaStatus;
}

/** The same call on a real seat: no `backend_version`, no `open_documents`. */
function seat(overrides: Record<string, unknown> = {}): CatiaStatus {
  return {
    connected: true,
    enabled: true,
    backend: "catia",
    paired_devices: 1,
    device_id: "dev_1",
    device_name: "WS-01",
    hostname: "ws-01",
    catia_version: "V5-6R2023",
    bridge_version: "0.2.0",
    mock: false,
    capabilities: [],
    ui_language: "fr",
    queue_depth: 0,
    connected_since: "2026-09-08T09:00:00Z",
    document: { doc_name: "Part1", latest_checkpoint_id: null, bound_at: "2026-09-08T09:00:00Z" },
    ...overrides,
  } as CatiaStatus;
}

describe("kernelRenderPath", () => {
  it("writes every parameter, including the ones that are also the defaults", () => {
    // The URL is the browser's cache key, and the endpoint's ETag is a real
    // content hash. A request that sometimes omits `view=iso` and sometimes
    // writes it is two cache entries for one picture, so the 304 never lands.
    expect(kernelRenderPath("conv_1")).toBe(
      "/kernel/conversations/conv_1/render?view=iso&width=1024&height=768",
    );
  });

  it("adds the section only when one was asked for", () => {
    expect(kernelRenderPath("conv_1", { ...DEFAULT_KERNEL_RENDER, section: "z" })).toContain(
      "&section=z",
    );
    expect(kernelRenderPath("conv_1")).not.toContain("section");
  });

  it("escapes the conversation id rather than pasting it into a path", () => {
    expect(kernelRenderPath("a/../b")).toContain("/conversations/a%2F..%2Fb/render");
  });

  it("names only cameras the backend serves", () => {
    // Mirrors `app/render/views.py::ALL_VIEWS`. Hand-maintained like every
    // type in this repo, so the list is pinned here rather than trusted.
    expect([...KERNEL_VIEWS]).toEqual([
      "front",
      "back",
      "left",
      "right",
      "top",
      "bottom",
      "iso",
      "iso_rear",
    ]);
  });
});

describe("kernelPartState", () => {
  it("shows nothing at all when a seat is what builds", () => {
    // The CATIA path has its own pictures, in the step rows. A second empty
    // frame beside them is furniture.
    expect(kernelPartState(seat(), "conv_1")).toEqual({ kind: "absent" });
  });

  it("shows nothing before the status has arrived, or with no conversation", () => {
    expect(kernelPartState(null, "conv_1")).toEqual({ kind: "absent" });
    expect(kernelPartState(openKernel(), null)).toEqual({ kind: "absent" });
  });

  it("shows nothing when the integration is switched off on the server", () => {
    expect(kernelPartState(openKernel({ enabled: false } as never), "conv_1")).toEqual({
      kind: "absent",
    });
  });

  it("waits, rather than drawing, when nothing has been built yet", () => {
    // A placeholder claiming a part exists is the exact reading this whole
    // module is written to prevent.
    expect(kernelPartState(openKernel({ document: null }), "conv_1")).toEqual({ kind: "waiting" });
  });

  it("distinguishes an evicted part from one that was never built", () => {
    // Both have no geometry and they are not the same fact: one is "ask for
    // something", the other is "what you had is gone and was never saved".
    expect(
      kernelPartState(openKernel({ document: { doc_name: null, evicted: true } }), "conv_1"),
    ).toEqual({ kind: "evicted" });
  });

  it("carries the kernel version through, because a picture is bound to what drew it", () => {
    expect(kernelPartState(openKernel(), "conv_1")).toEqual({
      kind: "ready",
      documentName: "Part",
      backendVersion: "OCCT 7.9.3",
    });
  });
});

describe("describeKernelView", () => {
  it("says what the picture is of and never what the part looks like", () => {
    // A screen reader gets this instead of the image. Nothing on this side has
    // looked at the pixels, so nothing here may describe the geometry.
    expect(describeKernelView(DEFAULT_KERNEL_RENDER)).toBe("Iso view of the part");
    expect(describeKernelView({ ...DEFAULT_KERNEL_RENDER, view: "iso_rear" })).toBe(
      "Rear isometric view of the part",
    );
  });

  it("says when the part was cut, because a cut drawing is not the part", () => {
    expect(describeKernelView({ ...DEFAULT_KERNEL_RENDER, view: "front", section: "z" })).toBe(
      "Front view, cut through the middle of Z",
    );
  });

  it("labels every view without leaving a raw backend token on screen", () => {
    for (const view of KERNEL_VIEWS) {
      const label = kernelViewLabel(view as KernelView);
      expect(label).not.toContain("_");
      expect(label[0]).toBe(label[0].toUpperCase());
    }
  });
});
