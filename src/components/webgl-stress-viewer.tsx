"use client";

import { useEffect, useRef, useState } from "react";

import type { SurfaceField } from "@/types/api";

const VERTEX_SHADER = `
attribute vec3 a_position;
attribute vec3 a_normal;
attribute float a_stress;
uniform mat4 u_modelView;
uniform mat4 u_projection;
varying vec3 v_normal;
varying float v_stress;
void main() {
  gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);
  v_normal = normalize(mat3(u_modelView) * a_normal);
  v_stress = a_stress;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 v_normal;
varying float v_stress;
void main() {
  vec3 lightDir = normalize(vec3(0.4, 0.7, 0.6));
  float diffuse = max(dot(v_normal, lightDir), 0.0);
  float ambient = 0.25;
  float intensity = ambient + (1.0 - ambient) * diffuse;

  // Colour ramp: blue → green → yellow → red
  float t = clamp(v_stress, 0.0, 1.0);
  vec3 color;
  if (t < 0.333) {
    color = mix(vec3(0.1, 0.2, 0.9), vec3(0.0, 0.8, 0.2), t / 0.333);
  } else if (t < 0.667) {
    color = mix(vec3(0.0, 0.8, 0.2), vec3(1.0, 1.0, 0.0), (t - 0.333) / 0.334);
  } else {
    color = mix(vec3(1.0, 1.0, 0.0), vec3(0.95, 0.15, 0.1), (t - 0.667) / 0.333);
  }
  gl_FragColor = vec4(color * intensity, 1.0);
}
`;

function compileShader(gl: WebGLRenderingContext, source: string, type: number): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile error: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

interface Props {
  data: SurfaceField;
}

export function WebGLStressViewer({ data }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotationRef = useRef({ x: -0.5, y: 0.7 });
  const draggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const lastPinchDistanceRef = useRef<number | null>(null);
  const distanceRef = useRef(3);
  const [scaleFactor, setScaleFactor] = useState(5);
  const [error, setError] = useState<string | null>(null);

  // Everything the displacement-scale effect needs to refresh the geometry
  // without rebuilding the GL program. `scaleFactor` is deliberately NOT a
  // dependency of the setup effect below: dragging the slider would otherwise
  // recompile the shaders and reallocate every buffer on each tick, when the
  // only thing that actually changed is vertex positions.
  const scaleFactorRef = useRef(scaleFactor);
  const refreshGeometryRef = useRef<((scale: number) => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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

      const positions = new Float32Array(data.node_positions.flat());
      const displacements = new Float32Array(data.displacements.flat());
      const triangles = data.triangles.flat();
      const stressPerVertex = data.von_mises_mpa;
      const maxStress = data.max_von_mises_mpa || 1;

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

      // Per-vertex stress normalised
      const stresses = new Float32Array(stressPerVertex.length);
      for (let i = 0; i < stresses.length; i++) {
        stresses[i] = stressPerVertex[i] / maxStress;
      }

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

      const stressBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, stressBuf);
      gl.bufferData(gl.ARRAY_BUFFER, stresses, gl.STATIC_DRAW);
      const aStress = gl.getAttribLocation(program, "a_stress");
      gl.enableVertexAttribArray(aStress);
      gl.vertexAttribPointer(aStress, 1, gl.FLOAT, false, 0, 0);

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
      let indices: Uint16Array | Uint32Array;
      if (maxIndex <= 65535) {
        indices = new Uint16Array(triangles);
      } else {
        gl.getExtension("OES_element_index_uint");
        indices = new Uint32Array(triangles);
      }
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

      const indexType = indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      const indexCount = triangles.length;

      // Re-upload just the vertex data when the slider moves. Same byte length
      // every time, so bufferSubData reuses the existing allocation and the
      // program, shaders, stress buffer and index buffer are all left alone.
      refreshGeometryRef.current = (scale: number) => {
        const next = computeGeometry(scale);
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, next.displaced);
        gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, next.normals);
      };

      // Cache the drawing buffer size; only resize when it actually changes.
      let lastWidth = 0;
      let lastHeight = 0;

      // Uniforms
      const uModelView = gl.getUniformLocation(program, "u_modelView");
      const uProjection = gl.getUniformLocation(program, "u_projection");

      let animationId: number;
      function render() {
        if (!canvas || !gl) return;
        const { width: cssW, height: cssH } = canvas.getBoundingClientRect();
        const newWidth = Math.round(cssW * devicePixelRatio);
        const newHeight = Math.round(cssH * devicePixelRatio);
        if (newWidth !== lastWidth || newHeight !== lastHeight) {
          canvas.width = newWidth;
          canvas.height = newHeight;
          lastWidth = newWidth;
          lastHeight = newHeight;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0.96, 0.97, 0.98, 1.0);
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

        gl.drawElements(gl.TRIANGLES, indexCount, indexType, 0);
        animationId = requestAnimationFrame(render);
      }
      render();

      return () => {
        cancelAnimationFrame(animationId);
        refreshGeometryRef.current = null;
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        // Delete every GL object. This now runs only when `data` changes or the
        // component unmounts, not on every slider tick.
        gl.deleteProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        for (const buf of [posBuf, normBuf, stressBuf, idxBuf]) {
          gl.deleteBuffer(buf);
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialise WebGL viewer.");
    }
  }, [data]);

  // Slider changes touch vertex data only -- see refreshGeometryRef above.
  useEffect(() => {
    scaleFactorRef.current = scaleFactor;
    refreshGeometryRef.current?.(scaleFactor);
  }, [scaleFactor]);

  function updatePointerRotation(dx: number, dy: number) {
    rotationRef.current.y += dx * 0.01;
    rotationRef.current.x += dy * 0.01;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    canvasRef.current?.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 1) {
      draggingRef.current = true;
      const point = pointersRef.current.values().next().value;
      if (point) {
        lastMouseRef.current = { x: point.x, y: point.y };
      }
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const previous = pointersRef.current.get(event.pointerId);
    if (!previous) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 1 && draggingRef.current) {
      updatePointerRotation(event.clientX - previous.x, event.clientY - previous.y);
      return;
    }

    if (pointersRef.current.size === 2) {
      const points = Array.from(pointersRef.current.values());
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (lastPinchDistanceRef.current !== null) {
        const scale = lastPinchDistanceRef.current / distance;
        distanceRef.current = Math.min(8, Math.max(0.8, distanceRef.current * scale));
      }
      lastPinchDistanceRef.current = distance;
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    canvasRef.current?.releasePointerCapture(event.pointerId);
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) lastPinchDistanceRef.current = null;
    if (pointersRef.current.size === 0) draggingRef.current = false;
  }

  function handleWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    distanceRef.current = Math.min(
      8,
      Math.max(0.8, distanceRef.current * (event.deltaY > 0 ? 1.08 : 0.93)),
    );
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
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted">Displacement</span>
        <input
          type="range"
          min={0}
          max={20}
          step={0.5}
          value={scaleFactor}
          onChange={(event) => setScaleFactor(Number(event.target.value))}
        />
        <span className="font-mono text-xs">{scaleFactor}×</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted">
        <span>0 MPa</span>
        <div
          aria-hidden="true"
          className="h-2 flex-1 rounded-full"
          style={{
            background: "linear-gradient(to right, #1a33e6, #00cc33, #ffff00, #f22619)",
          }}
        />
        <span>{data.max_von_mises_mpa.toFixed(1)} MPa</span>
      </div>
    </div>
  );
}
