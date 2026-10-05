"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  FIELDS,
  colourBuffer,
  legendFor,
  magnitudeOfFlat,
  probeNode,
  rampGradientCss,
  rangeFor,
  type FieldKind,
} from "@/lib/scalar-field";
import { currentTheme, subscribeTheme, viewerBackground } from "@/lib/theme";

import type { SurfaceFieldArrays } from "@/lib/surface-field";

const VERTEX_SHADER = `
attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec3 a_color;
uniform mat4 u_modelView;
uniform mat4 u_projection;
varying vec3 v_normal;
varying vec3 v_color;
void main() {
  gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);
  v_normal = normalize(mat3(u_modelView) * a_normal);
  v_color = a_color;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 v_normal;
varying vec3 v_color;
void main() {
  vec3 lightDir = normalize(vec3(0.4, 0.7, 0.6));
  float diffuse = max(dot(v_normal, lightDir), 0.0);
  float ambient = 0.25;
  float intensity = ambient + (1.0 - ambient) * diffuse;
  // The colour is a per-node attribute computed by lib/scalar-field.ts, so the picture, the
  // legend and the probe all come from one ramp. An unmeasured node arrives grey, not blue.
  gl_FragColor = vec4(v_color * intensity, 1.0);
}
`;

const MIN_DISTANCE = 0.8;
const MAX_DISTANCE = 8;

function compileShader(gl: WebGLRenderingContext, source: string, type: number): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile error: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

/** The two fields a structural solve leaves on the surface. */
type ShownKind = Extract<FieldKind, "stress" | "displacement">;

interface Props {
  data: SurfaceFieldArrays;
}

/** How close, in CSS pixels, a click must land to a node to read it. */
const PICK_RADIUS_PX = 18;

function valuesFor(data: SurfaceFieldArrays, kind: ShownKind): ArrayLike<number> {
  return kind === "stress" ? data.vonMisesMpa : magnitudeOfFlat(data.displacements);
}

export function WebGLStressViewer({ data }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotationRef = useRef({ x: -0.5, y: 0.7 });
  const draggingRef = useRef(false);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const lastPinchDistanceRef = useRef<number | null>(null);
  const distanceRef = useRef(3);
  const [scaleFactor, setScaleFactor] = useState(5);
  // What the surface is coloured by (ROAD_TO_10 8.3). Both fields come from the one solve.
  const [kind, setKind] = useState<ShownKind>("stress");
  const kindRef = useRef<ShownKind>(kind);
  const [probe, setProbe] = useState<string | null>(null);
  const pickRef = useRef<((clientX: number, clientY: number) => number | null) | null>(null);
  const recolourRef = useRef<((next: ShownKind) => void) | null>(null);
  const downAtRef = useRef<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextLost, setContextLost] = useState(false);
  /** Bumped on `webglcontextrestored` to rebuild every GL object from scratch. */
  const [glGeneration, setGlGeneration] = useState(0);

  // Everything the displacement-scale effect needs to refresh the geometry
  // without rebuilding the GL program. `scaleFactor` is deliberately NOT a
  // dependency of the setup effect below: dragging the slider would otherwise
  // recompile the shaders and reallocate every buffer on each tick, when the
  // only thing that actually changed is vertex positions.
  const scaleFactorRef = useRef(scaleFactor);
  const refreshGeometryRef = useRef<((scale: number) => void) | null>(null);

  /**
   * Ask for one frame.
   *
   * The viewer is a static scene: nothing moves unless the user drags, pinches,
   * scrolls, moves the slider, or the canvas resizes. A free-running
   * `requestAnimationFrame` loop would redraw an unchanged mesh 60 times a
   * second forever — on a laptop that is a warm fan and a flat battery for no
   * pixels gained. `geometry-preview.tsx` already renders on demand; this is
   * the same idea, one step further: with nothing dirty there is no scheduled
   * frame at all.
   */
  const invalidateRef = useRef<() => void>(() => {});
  const invalidate = useCallback(() => invalidateRef.current(), []);

  // The background follows the theme (8.5). The scene is static, so a theme change has to ask
  // for a frame or the old colour stays until the next drag.
  useEffect(() => {
    const redraw = () => invalidateRef.current();
    return subscribeTheme(redraw);
  }, []);

  // WebGL contexts are a finite, revocable resource: the driver resets, the GPU
  // is switched, or the tab is backgrounded long enough to be reclaimed. The
  // default behaviour is a permanently blank canvas with nothing in the console.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function handleLost(event: Event) {
      // Without preventDefault the browser will not fire `webglcontextrestored`.
      event.preventDefault();
      setContextLost(true);
    }
    function handleRestored() {
      setContextLost(false);
      setGlGeneration((generation) => generation + 1);
    }

    canvas.addEventListener("webglcontextlost", handleLost);
    canvas.addEventListener("webglcontextrestored", handleRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", handleLost);
      canvas.removeEventListener("webglcontextrestored", handleRestored);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || contextLost) return;
    const gl = canvas.getContext("webgl");
    if (!gl) {
      setError("WebGL is not available in this browser.");
      return;
    }

    try {
      const program = gl.createProgram()!;
      const vs = compileShader(gl, VERTEX_SHADER, gl.VERTEX_SHADER);
      const fs = compileShader(gl, FRAGMENT_SHADER, gl.FRAGMENT_SHADER);
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`Program link error: ${gl.getProgramInfoLog(program)}`);
      }
      gl.useProgram(program);

      // Typed arrays straight off the wire — no boxing, no `.flat()`, no copy.
      const positions = data.positions;
      const displacements = data.displacements;
      const triangles = data.triangles;

      /** Vertex positions and normals at a given displacement scale.
       *
       * Only these two depend on the slider. Stress values and the index buffer
       * do not, which is what makes a cheap `bufferSubData` refresh possible
       * instead of rebuilding the whole pipeline.
       */
      function computeGeometry(scale: number) {
        const displaced = new Float32Array(positions.length);
        for (let i = 0; i < positions.length; i += 3) {
          displaced[i] = positions[i] + displacements[i] * scale;
          displaced[i + 1] = positions[i + 1] + displacements[i + 1] * scale;
          displaced[i + 2] = positions[i + 2] + displacements[i + 2] * scale;
        }

        // Normalise positions to fit in [-1, 1]
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = 0; i < displaced.length; i += 3) {
          minX = Math.min(minX, displaced[i]);
          maxX = Math.max(maxX, displaced[i]);
          minY = Math.min(minY, displaced[i + 1]);
          maxY = Math.max(maxY, displaced[i + 1]);
          minZ = Math.min(minZ, displaced[i + 2]);
          maxZ = Math.max(maxZ, displaced[i + 2]);
        }
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
        const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
        for (let i = 0; i < displaced.length; i += 3) {
          displaced[i] = (displaced[i] - cx) / extent * 2;
          displaced[i + 1] = (displaced[i + 1] - cy) / extent * 2;
          displaced[i + 2] = (displaced[i + 2] - cz) / extent * 2;
        }

        // Face normals, area-weighted by accumulating the raw cross products.
        const normals = new Float32Array(displaced.length);
        for (let i = 0; i < triangles.length; i += 3) {
          const a = triangles[i], b = triangles[i + 1], c = triangles[i + 2];
          const ax = displaced[a * 3], ay = displaced[a * 3 + 1], az = displaced[a * 3 + 2];
          const bx = displaced[b * 3], by = displaced[b * 3 + 1], bz = displaced[b * 3 + 2];
          const cxv = displaced[c * 3], cyv = displaced[c * 3 + 1], czv = displaced[c * 3 + 2];
          const ux = bx - ax, uy = by - ay, uz = bz - az;
          const vx = cxv - ax, vy = cyv - ay, vz = czv - az;
          const nx = uy * vz - uz * vy;
          const ny = uz * vx - ux * vz;
          const nz = ux * vy - uy * vx;
          for (const idx of [a, b, c]) {
            normals[idx * 3] += nx;
            normals[idx * 3 + 1] += ny;
            normals[idx * 3 + 2] += nz;
          }
        }
        for (let i = 0; i < normals.length; i += 3) {
          const len = Math.sqrt(normals[i] ** 2 + normals[i + 1] ** 2 + normals[i + 2] ** 2) || 1;
          normals[i] /= len;
          normals[i + 1] /= len;
          normals[i + 2] /= len;
        }

        return { displaced, normals };
      }

      const { displaced, normals } = computeGeometry(scaleFactorRef.current);
      // What is on screen now, for picking: the displaced nodes, their normals and the matrices.
      let shownPositions = displaced;
      let shownNormals = normals;
      let lastModelView: Float32Array | null = null;
      let lastProjection: Float32Array | null = null;

      // Per-vertex colour from the shared ramp. Recomputed (not rebuilt) when the field changes.
      const colourFor = (shown: ShownKind): Float32Array => {
        const values = valuesFor(data, shown);
        return colourBuffer(values, shown, rangeFor(shown, values));
      };
      const colours = colourFor(kindRef.current);

      // Buffers
      const posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, displaced, gl.STATIC_DRAW);
      const aPosition = gl.getAttribLocation(program, "a_position");
      gl.enableVertexAttribArray(aPosition);
      gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);

      const normBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
      gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
      const aNormal = gl.getAttribLocation(program, "a_normal");
      gl.enableVertexAttribArray(aNormal);
      gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);

      const colourBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, colourBuf);
      gl.bufferData(gl.ARRAY_BUFFER, colours, gl.STATIC_DRAW);
      const aColour = gl.getAttribLocation(program, "a_color");
      gl.enableVertexAttribArray(aColour);
      gl.vertexAttribPointer(aColour, 3, gl.FLOAT, false, 0, 0);

      const idxBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
      // WebGL 1 needs the OES_element_index_uint extension for Uint32 indices.
      // Loop rather than Math.max(...triangles): spreading an array of a few
      // hundred thousand indices exceeds the argument limit and throws
      // RangeError, which is exactly the large-mesh case this branch exists for.
      let maxIndex = 0;
      for (const index of triangles) {
        if (index > maxIndex) maxIndex = index;
      }
      // Above 65535 the Uint32Array is used as-is: it is already the parsed
      // view onto the response body, so the large-mesh path allocates nothing.
      const indices: Uint16Array | Uint32Array =
        maxIndex <= 65535 ? new Uint16Array(triangles) : triangles;
      if (indices instanceof Uint32Array) gl.getExtension("OES_element_index_uint");
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

      const indexType = indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      const indexCount = triangles.length;

      // Uniforms
      const uModelView = gl.getUniformLocation(program, "u_modelView");
      const uProjection = gl.getUniformLocation(program, "u_projection");

      // Cached CSS size. Measured by ResizeObserver rather than by
      // getBoundingClientRect inside the frame: reading layout every frame
      // forces a synchronous reflow at 60fps, which is the expensive half of
      // the old loop even when nothing was drawn.
      let cssWidth = canvas.clientWidth;
      let cssHeight = canvas.clientHeight;
      let frameHandle = 0;
      let disposed = false;

      function draw() {
        if (!canvas || !gl || disposed || gl.isContextLost?.()) return;
        const ratio = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
        const width = Math.max(1, Math.round(cssWidth * ratio));
        const height = Math.max(1, Math.round(cssHeight * ratio));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        const [bgR, bgG, bgB] = viewerBackground(currentTheme());
        gl.clearColor(bgR, bgG, bgB, 1.0);
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        const rx = rotationRef.current.x;
        const ry = rotationRef.current.y;
        const dist = distanceRef.current;

        // Model-view: rotate then translate back
        const mv = new Float32Array(16);
        const cy_ = Math.cos(ry), sy_ = Math.sin(ry);
        const cx_ = Math.cos(rx), sx_ = Math.sin(rx);
        mv[0] = cy_;       mv[1] = sx_ * sy_;  mv[2] = -cx_ * sy_;
        mv[4] = 0;         mv[5] = cx_;        mv[6] = sx_;
        mv[8] = sy_;       mv[9] = -sx_ * cy_; mv[10] = cx_ * cy_;
        mv[14] = -dist;
        mv[15] = 1;

        const proj = new Float32Array(16);
        const fov = 45 * Math.PI / 180;
        const near = 0.1, far = 100;
        const f = 1 / Math.tan(fov / 2);
        const aspect = canvas.width / canvas.height;
        proj[0] = f / aspect;
        proj[5] = f;
        proj[10] = (far + near) / (near - far);
        proj[11] = -1;
        proj[14] = 2 * far * near / (near - far);

        gl.uniformMatrix4fv(uModelView, false, mv);
        gl.uniformMatrix4fv(uProjection, false, proj);
        lastModelView = mv;
        lastProjection = proj;

        gl.drawElements(gl.TRIANGLES, indexCount, indexType, 0);
      }

      function scheduleDraw() {
        if (disposed || frameHandle !== 0) return;
        frameHandle = requestAnimationFrame(() => {
          frameHandle = 0;
          draw();
        });
      }
      invalidateRef.current = scheduleDraw;

      // Re-upload just the vertex data when the slider moves. Same byte length
      // every time, so bufferSubData reuses the existing allocation and the
      // program, shaders, stress buffer and index buffer are all left alone.
      refreshGeometryRef.current = (scale: number) => {
        if (disposed || gl.isContextLost?.()) return;
        const next = computeGeometry(scale);
        shownPositions = next.displaced;
        shownNormals = next.normals;
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, next.displaced);
        gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, next.normals);
        scheduleDraw();
      };

      // Recolour in place when the field changes: same byte length, so bufferSubData.
      recolourRef.current = (next: ShownKind) => {
        if (disposed || gl.isContextLost?.()) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, colourBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, colourFor(next));
        scheduleDraw();
      };

      // The node nearest a click, among those facing the camera, or null if none is close.
      // Screen-space over the displayed nodes: no depth buffer read-back, no extra render.
      pickRef.current = (clientX: number, clientY: number) => {
        if (!lastModelView || !lastProjection || !canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const px = clientX - rect.left;
        const py = clientY - rect.top;
        const mv = lastModelView;
        const pr = lastProjection;
        let best = -1;
        let bestDistance = PICK_RADIUS_PX;
        for (let node = 0; node < shownPositions.length / 3; node++) {
          const x = shownPositions[node * 3];
          const y = shownPositions[node * 3 + 1];
          const z = shownPositions[node * 3 + 2];
          // Facing the camera: the view-space normal's z is positive.
          const nz = mv[2] * shownNormals[node * 3] + mv[6] * shownNormals[node * 3 + 1] + mv[10] * shownNormals[node * 3 + 2];
          if (nz <= 0) continue;
          const vx = mv[0] * x + mv[4] * y + mv[8] * z + mv[12];
          const vy = mv[1] * x + mv[5] * y + mv[9] * z + mv[13];
          const vz = mv[2] * x + mv[6] * y + mv[10] * z + mv[14];
          const cw = pr[11] * vz;
          if (cw <= 0) continue;
          const sx = ((pr[0] * vx) / cw * 0.5 + 0.5) * rect.width;
          const sy = (1 - ((pr[5] * vy) / cw * 0.5 + 0.5)) * rect.height;
          const distance = Math.hypot(sx - px, sy - py);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = node;
          }
        }
        return best >= 0 ? best : null;
      };

      let observer: ResizeObserver | null = null;
      function handleWindowResize() {
        cssWidth = canvas!.clientWidth;
        cssHeight = canvas!.clientHeight;
        scheduleDraw();
      }
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver((entries) => {
          const box = entries[0]?.contentRect;
          if (!box) return;
          cssWidth = box.width;
          cssHeight = box.height;
          scheduleDraw();
        });
        observer.observe(canvas);
      } else {
        // jsdom and very old browsers. One layout read per resize event, not per frame.
        window.addEventListener("resize", handleWindowResize);
      }

      scheduleDraw();

      return () => {
        disposed = true;
        if (frameHandle !== 0) cancelAnimationFrame(frameHandle);
        observer?.disconnect();
        window.removeEventListener("resize", handleWindowResize);
        refreshGeometryRef.current = null;
        recolourRef.current = null;
        pickRef.current = null;
        invalidateRef.current = () => {};
        // Delete every GL object. Note this does NOT call
        // WEBGL_lose_context.loseContext(): a force-lost context is never
        // handed back by getContext(), so doing that here would leave the
        // canvas permanently blank the next time this effect re-ran.
        gl.deleteProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        for (const buf of [posBuf, normBuf, colourBuf, idxBuf]) {
          gl.deleteBuffer(buf);
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialise WebGL viewer.");
    }
  }, [data, contextLost, glGeneration]);

  // A different field repaints the surface.
  useEffect(() => {
    kindRef.current = kind;
    recolourRef.current?.(kind);
  }, [kind]);

  // The legend, from the same field and range the colours were computed from.
  const legend = useMemo(() => {
    const values = valuesFor(data, kind);
    return legendFor(kind, values, rangeFor(kind, values));
  }, [data, kind]);

  // Slider changes touch vertex data only -- see refreshGeometryRef above.
  useEffect(() => {
    scaleFactorRef.current = scaleFactor;
    refreshGeometryRef.current?.(scaleFactor);
  }, [scaleFactor]);

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    canvasRef.current?.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 1) {
      draggingRef.current = true;
      downAtRef.current = { x: event.clientX, y: event.clientY };
    } else {
      downAtRef.current = null;
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const previous = pointersRef.current.get(event.pointerId);
    if (!previous) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 1 && draggingRef.current) {
      rotationRef.current.y += (event.clientX - previous.x) * 0.01;
      rotationRef.current.x += (event.clientY - previous.y) * 0.01;
      invalidate();
      return;
    }

    if (pointersRef.current.size === 2) {
      const points = Array.from(pointersRef.current.values());
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (lastPinchDistanceRef.current !== null && distance > 0) {
        const scale = lastPinchDistanceRef.current / distance;
        distanceRef.current = Math.min(
          MAX_DISTANCE,
          Math.max(MIN_DISTANCE, distanceRef.current * scale),
        );
        invalidate();
      }
      lastPinchDistanceRef.current = distance;
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    // A press that barely moved is a click, not a drag: read the node under it.
    const down = downAtRef.current;
    downAtRef.current = null;
    if (
      event.type === "pointerup" &&
      down &&
      Math.hypot(event.clientX - down.x, event.clientY - down.y) < 4
    ) {
      const node = pickRef.current?.(event.clientX, event.clientY) ?? null;
      setProbe(node === null ? null : probeNode(valuesFor(data, kind), kind, node).text);
    }
    canvasRef.current?.releasePointerCapture(event.pointerId);
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) lastPinchDistanceRef.current = null;
    if (pointersRef.current.size === 0) draggingRef.current = false;
  }

  function handleWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    distanceRef.current = Math.min(
      MAX_DISTANCE,
      Math.max(MIN_DISTANCE, distanceRef.current * (event.deltaY > 0 ? 1.08 : 0.93)),
    );
    invalidate();
  }

  if (error) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-muted/10 p-12 text-sm text-muted">
        {error} — falling back to the summary cards above.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="w-full cursor-grab touch-none rounded-lg border border-border bg-muted/10 active:cursor-grabbing"
          style={{ aspectRatio: "16 / 10" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
        />
        {contextLost && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-surface/90 p-6 text-center text-sm text-muted">
            The graphics context was lost — usually a driver reset or a
            backgrounded tab. The view rebuilds itself as soon as the browser
            hands it back; the numbers above are unaffected.
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 text-sm">
        <label className="text-muted" htmlFor="displacement-scale">
          Displacement
        </label>
        <input
          id="displacement-scale"
          type="range"
          min={0}
          max={20}
          step={0.5}
          value={scaleFactor}
          onChange={(event) => setScaleFactor(Number(event.target.value))}
        />
        <span className="font-mono text-xs">{scaleFactor}×</span>
      </div>
      <div className="flex items-center gap-2 text-sm" role="group" aria-label="Colour the surface by">
        {(["stress", "displacement"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={kind === option}
            onClick={() => {
              // The probe's reading belonged to the field it was taken from.
              setProbe(null);
              setKind(option);
            }}
            className={`k-pill ${kind === option ? "ring-1 ring-primary" : ""}`}
          >
            {FIELDS[option].label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted">
        <span>
          {legend.min.toFixed(kind === "stress" ? 1 : 3)} {legend.unit}
        </span>
        <div
          aria-hidden="true"
          className="h-2 flex-1 rounded-full"
          style={{ background: rampGradientCss(kind) }}
        />
        <span>
          {legend.max.toFixed(kind === "stress" ? 1 : 3)} {legend.unit}
        </span>
      </div>
      {/* The legend states its own bounds and that they were fitted, and any node that was not
          computed: two views with different fitted scales are not comparable. */}
      {legend.caveat && <p className="text-xs text-muted">{legend.caveat}</p>}
      {legend.absentNote && <p className="text-xs text-warning">{legend.absentNote}</p>}
      <p aria-live="polite" className="min-h-4 font-mono text-xs text-accent">
        {probe ?? "Click the surface to read a node."}
      </p>
    </div>
  );
}
