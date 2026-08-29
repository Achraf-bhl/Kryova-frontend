import { describe, expect, it } from "vitest";

import { parseBinarySurfaceField, surfaceFieldFromJson } from "./surface-field";

const HEADER_BYTES = 32;

interface BuildOptions {
  magic?: string;
  version?: number;
  nodes: number[][];
  triangles: number[][];
  displacements: number[][];
  vonMises: number[];
  maxVonMises?: number;
  maxDisplacement?: number;
  /** Chop bytes off the end to simulate a truncated response. */
  truncateBy?: number;
}

/**
 * Build a buffer byte-for-byte the way the backend's
 * `struct.pack("<4sIIIff8s", …)` plus four contiguous arrays does.
 *
 * Written independently of the parser on purpose: if both derived their strides
 * from the same constant, a wrong stride would agree with itself and the test
 * would pass while the viewer painted a meaningless stress field.
 */
function buildBuffer(options: BuildOptions): ArrayBuffer {
  const {
    magic = "KRYO",
    version = 1,
    nodes,
    triangles,
    displacements,
    vonMises,
    maxVonMises = 123.5,
    maxDisplacement = 0.25,
    truncateBy = 0,
  } = options;

  const total =
    HEADER_BYTES +
    nodes.length * 3 * 4 +
    triangles.length * 3 * 4 +
    displacements.length * 3 * 4 +
    vonMises.length * 4;

  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);

  for (let i = 0; i < 4; i++) view.setUint8(i, magic.charCodeAt(i));
  view.setUint32(4, version, true);
  view.setUint32(8, nodes.length, true);
  view.setUint32(12, triangles.length, true);
  view.setFloat32(16, maxVonMises, true);
  view.setFloat32(20, maxDisplacement, true);
  // bytes 24..31 are the reserved 8-byte tail, left zeroed

  let offset = HEADER_BYTES;
  for (const [x, y, z] of nodes) {
    view.setFloat32(offset, x, true);
    view.setFloat32(offset + 4, y, true);
    view.setFloat32(offset + 8, z, true);
    offset += 12;
  }
  for (const [a, b, c] of triangles) {
    view.setUint32(offset, a, true);
    view.setUint32(offset + 4, b, true);
    view.setUint32(offset + 8, c, true);
    offset += 12;
  }
  for (const [x, y, z] of displacements) {
    view.setFloat32(offset, x, true);
    view.setFloat32(offset + 4, y, true);
    view.setFloat32(offset + 8, z, true);
    offset += 12;
  }
  for (const value of vonMises) {
    view.setFloat32(offset, value, true);
    offset += 4;
  }

  return truncateBy > 0 ? buffer.slice(0, total - truncateBy) : buffer;
}

const SAMPLE: BuildOptions = {
  nodes: [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
    [10, 11, 12],
  ],
  triangles: [
    [0, 1, 2],
    [1, 2, 3],
  ],
  displacements: [
    [0.5, 0, 0],
    [0, 0.25, 0],
    [0, 0, 0.125],
    [1, 1, 1],
  ],
  vonMises: [10, 20, 30, 40],
};

describe("parseBinarySurfaceField", () => {
  it("reads every field at the right stride", () => {
    const field = parseBinarySurfaceField(buildBuffer(SAMPLE));

    expect(Array.from(field.positions)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(Array.from(field.triangles)).toEqual([0, 1, 2, 1, 2, 3]);
    expect(Array.from(field.displacements)).toEqual([0.5, 0, 0, 0, 0.25, 0, 0, 0, 0.125, 1, 1, 1]);
    expect(Array.from(field.vonMisesMpa)).toEqual([10, 20, 30, 40]);
    expect(field.maxVonMisesMpa).toBeCloseTo(123.5, 4);
    expect(field.maxDisplacementMm).toBeCloseTo(0.25, 4);
  });

  it("returns typed arrays rather than boxed tuples", () => {
    const field = parseBinarySurfaceField(buildBuffer(SAMPLE));
    expect(field.positions).toBeInstanceOf(Float32Array);
    expect(field.displacements).toBeInstanceOf(Float32Array);
    expect(field.vonMisesMpa).toBeInstanceOf(Float32Array);
    expect(field.triangles).toBeInstanceOf(Uint32Array);
  });

  it("keeps node and triangle blocks from bleeding into each other", () => {
    // Distinct counts: an off-by-one stride would shift one block into the next
    // and this is the case that catches it.
    const field = parseBinarySurfaceField(
      buildBuffer({
        nodes: [
          [1, 1, 1],
          [2, 2, 2],
          [3, 3, 3],
        ],
        triangles: [[0, 1, 2]],
        displacements: [
          [9, 9, 9],
          [8, 8, 8],
          [7, 7, 7],
        ],
        vonMises: [100, 200, 300],
      }),
    );
    expect(Array.from(field.positions)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
    expect(Array.from(field.triangles)).toEqual([0, 1, 2]);
    expect(Array.from(field.displacements)).toEqual([9, 9, 9, 8, 8, 8, 7, 7, 7]);
    expect(Array.from(field.vonMisesMpa)).toEqual([100, 200, 300]);
  });

  it("handles an empty mesh", () => {
    const field = parseBinarySurfaceField(
      buildBuffer({ nodes: [], triangles: [], displacements: [], vonMises: [] }),
    );
    expect(field.positions).toHaveLength(0);
    expect(field.triangles).toHaveLength(0);
  });

  it("rejects a buffer with the wrong magic", () => {
    expect(() => parseBinarySurfaceField(buildBuffer({ ...SAMPLE, magic: "NOPE" }))).toThrow(
      "Invalid binary surface field format",
    );
  });

  it("rejects a format version it does not know how to read", () => {
    expect(() => parseBinarySurfaceField(buildBuffer({ ...SAMPLE, version: 2 }))).toThrow(
      /Unsupported binary surface field version 2/,
    );
  });

  it("rejects a buffer too small to hold its own header", () => {
    expect(() => parseBinarySurfaceField(new ArrayBuffer(8))).toThrow(/truncated/);
  });

  it("rejects a body shorter than the declared counts", () => {
    expect(() => parseBinarySurfaceField(buildBuffer({ ...SAMPLE, truncateBy: 8 }))).toThrow(
      /truncated/,
    );
  });
});

describe("surfaceFieldFromJson", () => {
  it("flattens the JSON fallback into the same shape", () => {
    const field = surfaceFieldFromJson({
      node_positions: [
        [1, 2, 3],
        [4, 5, 6],
      ],
      triangles: [[0, 1, 1]],
      displacements: [
        [0, 0, 1],
        [0, 1, 0],
      ],
      von_mises_mpa: [5, 15],
      max_von_mises_mpa: 15,
      max_displacement_mm: 1,
    });

    expect(Array.from(field.positions)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(field.triangles)).toEqual([0, 1, 1]);
    expect(Array.from(field.displacements)).toEqual([0, 0, 1, 0, 1, 0]);
    expect(Array.from(field.vonMisesMpa)).toEqual([5, 15]);
    expect(field.maxVonMisesMpa).toBe(15);
    expect(field.maxDisplacementMm).toBe(1);
  });

  it("refuses a malformed row rather than silently shifting the mesh", () => {
    expect(() =>
      surfaceFieldFromJson({
        node_positions: [[1, 2]],
        triangles: [],
        displacements: [],
        von_mises_mpa: [],
        max_von_mises_mpa: 0,
        max_displacement_mm: 0,
      }),
    ).toThrow(/node_positions\[0\] has 2 components/);
  });
});
