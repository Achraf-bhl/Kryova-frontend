"use client";

import { useEffect, useRef, useState } from "react";

interface GeometryPreviewProps {
  positions: Array<[number, number, number]>;
  triangles: Array<[number, number, number]>;
}

export function GeometryPreview({ positions, triangles }: GeometryPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotationRef = useRef({ x: -0.3, y: 0.5 });
  const draggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;

    function render() {
      if (!canvas || !ctx) return;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = width * devicePixelRatio;
      canvas.height = height * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const [px, py, pz] of positions) {
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
      }
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const centerZ = (minZ + maxZ) / 2;
      const radius = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2 || 1;

      const rotX = rotationRef.current.x;
      const rotY = rotationRef.current.y;
      const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
      const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
      const scale = Math.min(width, height) * 0.8 / (radius * 2);

      const projected: Array<[number, number]> = [];
      for (const [px, py, pz] of positions) {
        const x = px - centerX, y = py - centerY, z = pz - centerZ;
        const x2 = x * cosY + z * sinY;
        const y2 = y * cosX - (-x * sinY + z * cosY) * sinX;
        projected.push([width / 2 + x2 * scale, height / 2 - y2 * scale]);
      }

      for (const [a, b, c] of triangles) {
        ctx.fillStyle = "rgba(100, 150, 220, 0.6)";
        ctx.beginPath();
        ctx.moveTo(projected[a][0], projected[a][1]);
        ctx.lineTo(projected[b][0], projected[b][1]);
        ctx.lineTo(projected[c][0], projected[c][1]);
        ctx.closePath();
        ctx.fill();
      }

      animationId = requestAnimationFrame(render);
    }

    render();
    return () => cancelAnimationFrame(animationId);
  }, [positions, triangles]);

  function handleMouseDown(event: React.MouseEvent) {
    draggingRef.current = true;
    setIsDragging(true);
    lastMouseRef.current = { x: event.clientX, y: event.clientY };
  }

  function handleMouseMove(event: React.MouseEvent) {
    if (!draggingRef.current) return;
    rotationRef.current.y += (event.clientX - lastMouseRef.current.x) * 0.01;
    rotationRef.current.x += (event.clientY - lastMouseRef.current.y) * 0.01;
    lastMouseRef.current = { x: event.clientX, y: event.clientY };
  }

  function handleMouseUp() {
    draggingRef.current = false;
    setIsDragging(false);
  }

  return (
    <canvas
      ref={canvasRef}
      className={`w-full rounded-lg border border-border bg-slate-50 ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
      style={{ aspectRatio: "16 / 10" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    />
  );
}
