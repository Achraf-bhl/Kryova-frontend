import type { SurfaceField } from "@/types/api";

/**
 * Flat, typed-array form of a solved surface field — the shape the WebGL
 * viewer uploads to the GPU directly.
 *
 * The wire types in `types/api.ts` mirror the backend's JSON (`number[][]`),
 * which is fine as a schema but ruinous as a runtime representation: a mesh at
 * the backend's 400k-element cap has millions of nodes, and turning each one
 * into a boxed `[x, y, z]` tuple only for the viewer to `.flat()` it back costs
 * several full copies and a lot of GC pressure. Everything downstream of the
 * network boundary uses this instead.
 *
 * Units are the backend's own: positions and displacements in mm, stress in
 * MPa. Nothing is scaled on the way here.
 */
export interface SurfaceFieldArrays {
  /** xyz per node, length `nodeCount * 3` (mm). */
  positions: Float32Array;
  /** xyz per node, length `nodeCount * 3` (mm). */
  displacements: Float32Array;
  /** Triangle corner indices, length `triangleCount * 3`. */
  triangles: Uint32Array;
  /** One value per node (MPa). */
  vonMisesMpa: Float32Array;
  maxVonMisesMpa: number;
  maxDisplacementMm: number;
}

/** Byte offsets of the `<4sIIIff8s` header the backend packs. */
const HEADER_BYTES = 32;
const MAGIC = "KRYO";
const SUPPORTED_VERSION = 1;

function flattenTriples(rows: number[][], label: string): Float32Array {
  const out = new Float32Array(rows.length * 3);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.length !== 3) {
      throw new Error(`${label}[${i}] has ${row.length} components, expected 3`);
    }
    out[i * 3] = row[0];
    out[i * 3 + 1] = row[1];
    out[i * 3 + 2] = row[2];
  }
  return out;
}

/**
 * Convert the JSON surface payload into the typed-array form.
 *
 * Only used on the fallback path — the binary endpoint is parsed straight into
 * typed arrays with no intermediate boxing at all.
 */
export function surfaceFieldFromJson(field: SurfaceField): SurfaceFieldArrays {
  const triangles = new Uint32Array(field.triangles.length * 3);
  for (let i = 0; i < field.triangles.length; i++) {
    const row = field.triangles[i];
    if (row.length !== 3) {
      throw new Error(`triangles[${i}] has ${row.length} corners, expected 3`);
    }
    triangles[i * 3] = row[0];
    triangles[i * 3 + 1] = row[1];
    triangles[i * 3 + 2] = row[2];
  }

  return {
    positions: flattenTriples(field.node_positions, "node_positions"),
    displacements: flattenTriples(field.displacements, "displacements"),
    triangles,
    vonMisesMpa: Float32Array.from(field.von_mises_mpa),
    maxVonMisesMpa: field.max_von_mises_mpa,
    maxDisplacementMm: field.max_displacement_mm,
  };
}

/**
 * Parse the backend's binary surface format (`GET …/surface/binary`).
 *
 * Layout, little-endian, matching `struct.pack("<4sIIIff8s", …)` plus four
 * contiguous arrays:
 *
 * ```
 *  0  magic "KRYO"        (4 bytes)
 *  4  format version      (uint32)
 *  8  node count N        (uint32)
 * 12  triangle count T    (uint32)
 * 16  max von Mises, MPa  (float32)
 * 20  max displacement,mm (float32)
 * 24  reserved            (8 bytes)
 * 32  node positions      (N * 3 float32)
 *     triangle indices    (T * 3 uint32)
 *     displacements       (N * 3 float32)
 *     nodal von Mises     (N     float32)
 * ```
 *
 * The returned arrays are views onto `buffer`, so the caller must not reuse
 * the buffer for anything else. Strides are asserted against the declared
 * counts up front: one wrong offset renders a plausible-looking but completely
 * wrong stress field, which is worse than an error.
 */
export function parseBinarySurfaceField(buffer: ArrayBuffer): SurfaceFieldArrays {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new Error(
      `Binary surface field is truncated: ${buffer.byteLength} bytes, header alone needs ${HEADER_BYTES}`,
    );
  }

  const header = new DataView(buffer, 0, HEADER_BYTES);
  const magic = String.fromCharCode(
    header.getUint8(0),
    header.getUint8(1),
    header.getUint8(2),
    header.getUint8(3),
  );
  if (magic !== MAGIC) {
    throw new Error("Invalid binary surface field format");
  }

  const version = header.getUint32(4, true);
  if (version !== SUPPORTED_VERSION) {
    throw new Error(
      `Unsupported binary surface field version ${version} (this client reads version ${SUPPORTED_VERSION})`,
    );
  }

  const nodeCount = header.getUint32(8, true);
  const triangleCount = header.getUint32(12, true);
  const maxVonMisesMpa = header.getFloat32(16, true);
  const maxDisplacementMm = header.getFloat32(20, true);

  const nodeBytes = nodeCount * 3 * 4;
  const triangleBytes = triangleCount * 3 * 4;
  const stressBytes = nodeCount * 4;
  const expected = HEADER_BYTES + nodeBytes + triangleBytes + nodeBytes + stressBytes;
  if (buffer.byteLength < expected) {
    throw new Error(
      `Binary surface field is truncated: ${buffer.byteLength} bytes, ` +
        `${nodeCount} nodes and ${triangleCount} triangles need ${expected}`,
    );
  }

  let offset = HEADER_BYTES;
  const positions = new Float32Array(buffer, offset, nodeCount * 3);
  offset += nodeBytes;
  const triangles = new Uint32Array(buffer, offset, triangleCount * 3);
  offset += triangleBytes;
  const displacements = new Float32Array(buffer, offset, nodeCount * 3);
  offset += nodeBytes;
  const vonMisesMpa = new Float32Array(buffer, offset, nodeCount);

  return {
    positions,
    displacements,
    triangles,
    vonMisesMpa,
    maxVonMisesMpa,
    maxDisplacementMm,
  };
}
