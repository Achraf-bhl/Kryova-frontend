"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import type {
  Fixture,
  GeometryVersionRead,
  LoadCasePayload,
  Material,
  Selector,
} from "@/types/api";

const AXES = ["x", "y", "z"] as const;
const SIDES = ["min", "max"] as const;
const DOFS = ["x", "y", "z"] as const;
type SelectorType = "face" | "box";
type Axis = "x" | "y" | "z";
type Side = "min" | "max";

interface BoxCoords {
  x: string;
  y: string;
  z: string;
}

function buildFaceSelector(axis: Axis, side: Side): Selector {
  return { type: "face", axis, side };
}

function buildBoxSelector(min: BoxCoords, max: BoxCoords): Selector | null {
  const minV = [Number(min.x), Number(min.y), Number(min.z)];
  const maxV = [Number(max.x), Number(max.y), Number(max.z)];
  if (minV.some(Number.isNaN) || maxV.some(Number.isNaN)) return null;
  return { type: "box", min: minV as [number, number, number], max: maxV as [number, number, number] };
}

export default function SimulatePage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const router = useRouter();

  const [materials, setMaterials] = useState<Material[]>([]);
  const [geometryVersions, setGeometryVersions] = useState<GeometryVersionRead[]>([]);
  const [selectedMaterial, setSelectedMaterial] = useState<string>("");
  const [geometryVersion, setGeometryVersion] = useState<string>("");
  const [elementSize, setElementSize] = useState<string>("");
  const [loadName, setLoadName] = useState("Load case 1");

  // Simple single fixture + single load UI (the API supports arrays).
  const [fixtureType, setFixtureType] = useState<SelectorType>("face");
  const [fixtureAxis, setFixtureAxis] = useState<"x" | "y" | "z">("z");
  const [fixtureSide, setFixtureSide] = useState<"min" | "max">("min");
  const [fixtureDofs, setFixtureDofs] = useState<Set<"x" | "y" | "z">>(new Set(["x", "y", "z"]));
  const [fixtureBoxMin, setFixtureBoxMin] = useState({ x: "", y: "", z: "" });
  const [fixtureBoxMax, setFixtureBoxMax] = useState({ x: "", y: "", z: "" });

  const [loadType, setLoadType] = useState<SelectorType>("face");
  const [loadAxis, setLoadAxis] = useState<"x" | "y" | "z">("z");
  const [loadSide, setLoadSide] = useState<"min" | "max">("max");
  const [loadBoxMin, setLoadBoxMin] = useState({ x: "", y: "", z: "" });
  const [loadBoxMax, setLoadBoxMax] = useState({ x: "", y: "", z: "" });
  const [forceX, setForceX] = useState("0");
  const [forceY, setForceY] = useState("0");
  const [forceZ, setForceZ] = useState("-1000");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.listMaterials(), api.listGeometry(projectId)])
      .then(([materialData, geometryData]) => {
        setMaterials(materialData.materials);
        setGeometryVersions(geometryData.items);
        if (materialData.materials.length > 0) {
          setSelectedMaterial(materialData.materials[0].name);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load form data"));
  }, [projectId]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const material = materials.find((m) => m.name === selectedMaterial);
    if (!material || !loadName.trim()) return;

    const fixtureWhere = fixtureType === "face"
      ? buildFaceSelector(fixtureAxis, fixtureSide)
      : buildBoxSelector(fixtureBoxMin, fixtureBoxMax);
    if (!fixtureWhere) {
      setError("Fixture box coordinates must all be valid numbers.");
      return;
    }
    const fixture: Fixture = {
      where: fixtureWhere,
      dofs: Array.from(fixtureDofs),
    };

    let loadWhere: Selector;
    if (loadType === "face") {
      loadWhere = buildFaceSelector(loadAxis, loadSide);
    } else {
      const selector = buildBoxSelector(loadBoxMin, loadBoxMax);
      if (!selector) {
        setError("Load box coordinates must all be valid numbers.");
        return;
      }
      loadWhere = selector;
    }

    const loadCase: LoadCasePayload = {
      name: loadName.trim(),
      material,
      fixtures: [fixture],
      loads: [{ where: loadWhere, force_n: [Number(forceX) || 0, Number(forceY) || 0, Number(forceZ) || 0] }],
    };

    setSubmitting(true);
    try {
      const simulation = await api.createSimulation(projectId, {
        load_case: loadCase,
        element_size_mm: elementSize ? Number(elementSize) : null,
        geometry_version: geometryVersion ? Number(geometryVersion) : null,
      });
      router.push(`/dashboard/projects/${projectId}/simulations/${simulation.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start simulation");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <div>
        <Link href={`/dashboard/projects/${projectId}`} className="text-sm text-muted hover:text-accent">
          ← Back to project
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New simulation</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6 rounded-lg bg-surface p-6 shadow-card">
        {/* Basic */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Input id="load-name" label="Load case name" value={loadName} onChange={(e) => setLoadName(e.target.value)} required />
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-muted">Material</span>
            <select
              value={selectedMaterial}
              onChange={(e) => setSelectedMaterial(e.target.value)}
              className="h-10 rounded-md border border-border bg-surface px-3 outline-none focus:border-primary"
            >
              {materials.map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
          </label>
          <Input id="element-size" label="Element size (mm, optional)" type="number" min="0.1" step="any" value={elementSize} onChange={(e) => setElementSize(e.target.value)} placeholder="Auto" />
        </div>

        {/* Geometry version */}
        {geometryVersions.length > 1 && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-muted">Geometry version</span>
            <select
              value={geometryVersion}
              onChange={(e) => setGeometryVersion(e.target.value)}
              className="h-10 rounded-md border border-border bg-surface px-3 outline-none focus:border-primary"
            >
              <option value="">Latest</option>
              {geometryVersions.map((v) => (
                <option key={v.id} value={String(v.version_number)}>
                  v{v.version_number} — {v.filename}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* Fixture */}
        <fieldset className="rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-medium">Fixture</legend>
          <div className="mb-3 flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="fixture-type" checked={fixtureType === "face"} onChange={() => setFixtureType("face")} />
              Face
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="fixture-type" checked={fixtureType === "box"} onChange={() => setFixtureType("box")} />
              Box region
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            {fixtureType === "face" ? (
              <>
                <label className="text-sm">
                  <span className="mb-1 block text-muted">Axis</span>
                  <select value={fixtureAxis} onChange={(e) => setFixtureAxis(e.target.value as typeof AXES[number])} className="h-9 rounded border border-border px-2">
                    {AXES.map((a) => <option key={a}>{a}</option>)}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-muted">Face</span>
                  <select value={fixtureSide} onChange={(e) => setFixtureSide(e.target.value as typeof SIDES[number])} className="h-9 rounded border border-border px-2">
                    {SIDES.map((s) => <option key={s} value={s}>{s === "min" ? "Lowest" : "Highest"}</option>)}
                  </select>
                </label>
              </>
            ) : (
              <div className="flex gap-4 text-sm">
                <div>
                  <span className="mb-1 block font-medium text-muted">Min (mm)</span>
                  <div className="flex gap-2">
                    {(["x", "y", "z"] as const).map((axis) => (
                      <input key={axis} placeholder={axis.toUpperCase()} type="number" step="any" value={fixtureBoxMin[axis]} onChange={(e) => setFixtureBoxMin(p => ({ ...p, [axis]: e.target.value }))} className="h-9 w-20 rounded border border-border px-2" />
                    ))}
                  </div>
                </div>
                <div>
                  <span className="mb-1 block font-medium text-muted">Max (mm)</span>
                  <div className="flex gap-2">
                    {(["x", "y", "z"] as const).map((axis) => (
                      <input key={axis} placeholder={axis.toUpperCase()} type="number" step="any" value={fixtureBoxMax[axis]} onChange={(e) => setFixtureBoxMax(p => ({ ...p, [axis]: e.target.value }))} className="h-9 w-20 rounded border border-border px-2" />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="text-sm">
              <span className="mb-1 block text-muted">Constrained DOFs</span>
              <div className="flex gap-3">
                {DOFS.map((dof) => (
                  <label key={dof} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={fixtureDofs.has(dof)}
                      onChange={() => {
                        setFixtureDofs((previous) => {
                          const next = new Set(previous);
                          if (next.has(dof)) next.delete(dof);
                          else next.add(dof);
                          return next;
                        });
                      }}
                    />
                    {dof.toUpperCase()}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </fieldset>

        {/* Force */}
        <fieldset className="rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-medium">Applied force</legend>
          <div className="mb-3 flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="load-type" checked={loadType === "face"} onChange={() => setLoadType("face")} />
              Face
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="load-type" checked={loadType === "box"} onChange={() => setLoadType("box")} />
              Box region
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            {loadType === "face" ? (
              <label className="text-sm">
                <span className="mb-1 block text-muted">Surface</span>
                <select value={`${loadAxis}:${loadSide}`} onChange={(e) => {
                  const [axis, side] = e.target.value.split(":") as ["x" | "y" | "z", "min" | "max"];
                  setLoadAxis(axis);
                  setLoadSide(side);
                }} className="h-9 rounded border border-border px-2">
                  {AXES.flatMap((axis) =>
                    SIDES.map((side) => (
                      <option key={`${axis}:${side}`} value={`${axis}:${side}`}>
                        {side === "min" ? "Lowest" : "Highest"} {axis.toUpperCase()} face
                      </option>
                    )),
                  )}
                </select>
              </label>
            ) : (
              <div className="flex gap-4 text-sm">
                <div>
                  <span className="mb-1 block font-medium text-muted">Min (mm)</span>
                  <div className="flex gap-2">
                    {(["x", "y", "z"] as const).map((axis) => (
                      <input key={axis} placeholder={axis.toUpperCase()} type="number" step="any" value={loadBoxMin[axis]} onChange={(e) => setLoadBoxMin(p => ({ ...p, [axis]: e.target.value }))} className="h-9 w-20 rounded border border-border px-2" />
                    ))}
                  </div>
                </div>
                <div>
                  <span className="mb-1 block font-medium text-muted">Max (mm)</span>
                  <div className="flex gap-2">
                    {(["x", "y", "z"] as const).map((axis) => (
                      <input key={axis} placeholder={axis.toUpperCase()} type="number" step="any" value={loadBoxMax[axis]} onChange={(e) => setLoadBoxMax(p => ({ ...p, [axis]: e.target.value }))} className="h-9 w-20 rounded border border-border px-2" />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <Input id="force-x" label="Fx (N)" type="number" step="any" value={forceX} onChange={(e) => setForceX(e.target.value)} className="w-24" />
            <Input id="force-y" label="Fy (N)" type="number" step="any" value={forceY} onChange={(e) => setForceY(e.target.value)} className="w-24" />
            <Input id="force-z" label="Fz (N)" type="number" step="any" value={forceZ} onChange={(e) => setForceZ(e.target.value)} className="w-24" />
          </div>
        </fieldset>

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button type="submit" loading={submitting}>
          Run simulation
        </Button>
      </form>
    </div>
  );
}
