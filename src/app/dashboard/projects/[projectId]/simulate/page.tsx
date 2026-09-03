"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { FixtureEditor } from "@/components/simulate/fixture-editor";
import { LoadEditor } from "@/components/simulate/load-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api-client";
import {
  newFixture,
  newLoad,
  toPayload,
  validateLoadCase,
  type FixtureRow,
  type LoadRow,
} from "@/lib/load-case";
import type { GeometryVersionRead, Material } from "@/types/api";

export default function SimulatePage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const router = useRouter();

  const [materials, setMaterials] = useState<Material[]>([]);
  const [geometryVersions, setGeometryVersions] = useState<GeometryVersionRead[]>([]);
  const [selectedMaterial, setSelectedMaterial] = useState<string>("");
  const [geometryVersion, setGeometryVersion] = useState<string>("");
  const [elementSize, setElementSize] = useState<string>("");
  const [elementOrder, setElementOrder] = useState<"1" | "2">("1");
  const [loadName, setLoadName] = useState("Load case 1");

  // The case is a list of each, not one of each. That is the whole reason this
  // page was rewritten: the schema always allowed arrays, and the old flat
  // `useState` strings had nowhere to put a second fixture.
  const [fixtures, setFixtures] = useState<FixtureRow[]>(() => [newFixture()]);
  const [loads, setLoads] = useState<LoadRow[]>(() => [newLoad("force")]);

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

  const material = useMemo(
    () => materials.find((candidate) => candidate.name === selectedMaterial),
    [materials, selectedMaterial],
  );

  // Recomputed on every edit so the list shrinks as problems are fixed, but
  // only *shown* after a submit attempt -- flagging an empty form the moment it
  // opens trains people to ignore the messages.
  const problems = useMemo(
    () => validateLoadCase(fixtures, loads, material),
    [fixtures, loads, material],
  );
  const [showProblems, setShowProblems] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (problems.length > 0 || !material) {
      setShowProblems(true);
      return;
    }

    setSubmitting(true);
    try {
      const simulation = await api.createSimulation(projectId, {
        load_case: toPayload(loadName, material, fixtures, loads),
        element_size_mm: elementSize ? Number(elementSize) : null,
        element_order: Number(elementOrder) as 1 | 2,
        geometry_version: geometryVersion ? Number(geometryVersion) : null,
      });
      router.push(`/dashboard/projects/${projectId}/simulations/${simulation.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start simulation");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6">
      <div>
        <Link
          href={`/dashboard/projects/${projectId}`}
          className="text-sm text-muted hover:text-accent"
        >
          ← Back to project
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">New simulation</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6 rounded-lg bg-surface p-6 shadow-card">
        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            id="load-name"
            label="Load case name"
            value={loadName}
            onChange={(event) => setLoadName(event.target.value)}
            required
          />
          <Select
            label="Material"
            value={selectedMaterial}
            options={materials.map((candidate) => ({
              value: candidate.name,
              label: candidate.name,
            }))}
            onChange={(event) => setSelectedMaterial(event.target.value)}
          />
          <Input
            id="element-size"
            label="Element size (mm, optional)"
            type="number"
            min="0.1"
            step="any"
            value={elementSize}
            onChange={(event) => setElementSize(event.target.value)}
            placeholder="Auto"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Element order"
            value={elementOrder}
            options={[
              { value: "1", label: "Linear (tet4) — faster" },
              { value: "2", label: "Quadratic (tet10) — accurate in bending" },
            ]}
            onChange={(event) => setElementOrder(event.target.value as "1" | "2")}
          />
          {geometryVersions.length > 1 && (
            <Select
              label="Geometry version"
              value={geometryVersion}
              placeholder="Latest"
              options={geometryVersions.map((version) => ({
                value: String(version.version_number),
                label: `v${version.version_number}`,
              }))}
              onChange={(event) => setGeometryVersion(event.target.value)}
            />
          )}
        </div>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Fixtures</h2>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setFixtures((current) => [...current, newFixture()])}
            >
              Add fixture
            </Button>
          </div>
          {fixtures.map((fixture, index) => (
            <FixtureEditor
              key={fixture.id}
              fixture={fixture}
              index={index}
              removable={fixtures.length > 1}
              onChange={(next) =>
                setFixtures((current) =>
                  current.map((candidate) => (candidate.id === next.id ? next : candidate)),
                )
              }
              onRemove={() =>
                setFixtures((current) =>
                  current.filter((candidate) => candidate.id !== fixture.id),
                )
              }
            />
          ))}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Loads</h2>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setLoads((current) => [...current, newLoad("force")])}
            >
              Add load
            </Button>
          </div>
          {loads.map((load, index) => (
            <LoadEditor
              key={load.id}
              load={load}
              index={index}
              removable={loads.length > 1}
              onChange={(next) =>
                setLoads((current) =>
                  current.map((candidate) => (candidate.id === next.id ? next : candidate)),
                )
              }
              onRemove={() =>
                setLoads((current) => current.filter((candidate) => candidate.id !== load.id))
              }
            />
          ))}
        </section>

        {showProblems && problems.length > 0 && (
          <div className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
            <p className="font-medium">Fix these before running:</p>
            <ul className="mt-1 list-disc pl-5">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button type="submit" loading={submitting} disabled={submitting}>
          Run simulation
        </Button>
      </form>
    </div>
  );
}
