import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SurfaceField } from "@/types/api";
import { surfaceFieldFromJson } from "@/lib/surface-field";
import { WebGLStressViewer } from "./webgl-stress-viewer";

const MINIMAL_SURFACE: SurfaceField = {
  node_positions: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  triangles: [[0, 1, 2]],
  displacements: [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ],
  von_mises_mpa: [10, 20, 30],
  max_von_mises_mpa: 30,
  max_displacement_mm: 0,
};

const MINIMAL_ARRAYS = surfaceFieldFromJson(MINIMAL_SURFACE);

function createMockGL() {
  const deleteProgram = vi.fn();
  const deleteShader = vi.fn();
  const deleteBuffer = vi.fn();
  const loseContext = vi.fn();

  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    ELEMENT_ARRAY_BUFFER: 6,
    STATIC_DRAW: 7,
    FLOAT: 8,
    UNSIGNED_SHORT: 9,
    UNSIGNED_INT: 10,
    TRIANGLES: 11,
    COLOR_BUFFER_BIT: 12,
    DEPTH_BUFFER_BIT: 13,
    DEPTH_TEST: 14,
    CULL_FACE: 15,
    createProgram: vi.fn(() => ({})),
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ""),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ""),
    useProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    bufferSubData: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn(() => ({})),
    getExtension: vi.fn((name: string) =>
      name === "WEBGL_lose_context" ? { loseContext } : null,
    ),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    enable: vi.fn(),
    clear: vi.fn(),
    uniformMatrix4fv: vi.fn(),
    drawElements: vi.fn(),
    deleteProgram,
    deleteShader,
    deleteBuffer,
    isContextLost: vi.fn(() => false),
  };

  return { gl, deleteProgram, deleteShader, deleteBuffer, loseContext };
}

describe("WebGLStressViewer", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext =
      originalGetContext as typeof HTMLCanvasElement.prototype.getContext;
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders without crashing given a minimal mesh", () => {
    const { gl } = createMockGL();
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => gl,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const { container } = render(<WebGLStressViewer data={MINIMAL_ARRAYS} />);

    expect(container.querySelector("canvas")).toBeInTheDocument();
    expect(screen.getByText(/30\.0 MPa/)).toBeInTheDocument();
  });

  it("disposes every GL object on unmount", () => {
    const { gl, deleteProgram, deleteShader, deleteBuffer } = createMockGL();
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => gl,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const { unmount } = render(<WebGLStressViewer data={MINIMAL_ARRAYS} />);
    expect(deleteProgram).not.toHaveBeenCalled();

    unmount();

    expect(deleteProgram).toHaveBeenCalledTimes(1);
    // Vertex shader + fragment shader.
    expect(deleteShader).toHaveBeenCalledTimes(2);
    // Position, normal, stress, and index buffers.
    expect(deleteBuffer).toHaveBeenCalledTimes(4);
  });

  it("degrades to a fallback message when WebGL is unavailable, rather than crashing", () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => null,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    render(<WebGLStressViewer data={MINIMAL_ARRAYS} />);

    expect(screen.getByText(/WebGL is not available/i)).toBeInTheDocument();
  });
});
