"use client";

import { SelectorFields } from "@/components/simulate/selector-fields";
import { VectorField } from "@/components/simulate/vector-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  LOAD_TYPE_LABELS,
  SELECTORS_FOR_LOAD,
  changeLoadType,
  isBodyLoad,
  type LoadRow,
} from "@/lib/load-case";
import { STANDARD_GRAVITY_MM_S2, type LoadType } from "@/types/api";

const TYPE_OPTIONS = (Object.keys(LOAD_TYPE_LABELS) as LoadType[]).map((type) => ({
  value: type,
  label: LOAD_TYPE_LABELS[type],
}));

interface LoadEditorProps {
  load: LoadRow;
  index: number;
  onChange: (load: LoadRow) => void;
  onRemove: () => void;
  removable: boolean;
}

/** One applied load, with the fields its type actually needs. */
export function LoadEditor({ load, index, onChange, onRemove, removable }: LoadEditorProps) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <legend className="text-sm font-semibold">Load {index + 1}</legend>
        {removable && (
          <Button type="button" variant="secondary" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          id={`${load.id}-name`}
          label="Name (optional)"
          value={load.name ?? ""}
          placeholder="e.g. tip load"
          onChange={(event) => onChange({ ...load, name: event.target.value })}
        />
        <Select
          label="Kind"
          value={load.type}
          options={TYPE_OPTIONS}
          onChange={(event) => onChange(changeLoadType(load, event.target.value as LoadType))}
        />
      </div>

      {/* A body load has no region: gravity and rotation act on every element. */}
      {!isBodyLoad(load) && "where" in load && (
        <SelectorFields
          value={load.where}
          allowed={SELECTORS_FOR_LOAD[load.type]}
          onChange={(where) => onChange({ ...load, where } as LoadRow)}
        />
      )}

      {load.type === "force" && (
        <VectorField
          label="Total force"
          unit="N"
          value={load.force_n}
          onChange={(force_n) => onChange({ ...load, force_n })}
          hint="Spread over the region by area, so refining the mesh does not change it."
        />
      )}

      {load.type === "pressure" && (
        <Input
          id={`${load.id}-pressure`}
          label="Pressure (MPa)"
          type="number"
          step="any"
          value={String(load.pressure_mpa)}
          onChange={(event) =>
            onChange({ ...load, pressure_mpa: Number(event.target.value) || 0 })
          }
        />
      )}
      {load.type === "pressure" && (
        <p className="text-xs text-muted">
          Acts along the surface&apos;s own normal; positive pushes inward. Unlike a force,
          it scales with the area it acts on.
        </p>
      )}

      {load.type === "moment" && (
        <VectorField
          label="Moment"
          unit="N·mm"
          value={load.moment_n_mm}
          onChange={(moment_n_mm) => onChange({ ...load, moment_n_mm })}
          hint="About an axis through the region's centroid. The surface stays free to deform, so stresses right at it are softer than a bolted joint."
        />
      )}

      {load.type === "bearing" && (
        <>
          <VectorField
            label="Pin force"
            unit="N"
            value={load.force_n}
            onChange={(force_n) => onChange({ ...load, force_n })}
          />
          <Input
            id={`${load.id}-distribution`}
            label="Concentration"
            type="number"
            step="0.1"
            min="0.5"
            max="3"
            value={String(load.distribution ?? 1)}
            onChange={(event) =>
              onChange({ ...load, distribution: Number(event.target.value) || 1 })
            }
          />
          <p className="text-xs text-muted">
            Only the half of the bore facing the load carries it, peaking at the contact.
            1.0 is the classical cosine distribution; higher concentrates it further.
          </p>
        </>
      )}

      {load.type === "gravity" && (
        <>
          <VectorField
            label="Direction"
            value={load.direction ?? [0, 0, -1]}
            onChange={(direction) => onChange({ ...load, direction })}
            hint="Length is ignored; only the direction is used."
          />
          <Input
            id={`${load.id}-g`}
            label="Acceleration (mm/s²)"
            type="number"
            step="any"
            min="0"
            value={String(load.magnitude_mm_s2 ?? STANDARD_GRAVITY_MM_S2)}
            onChange={(event) =>
              onChange({ ...load, magnitude_mm_s2: Number(event.target.value) || 0 })
            }
          />
          <p className="text-xs text-muted">
            Standard gravity is {STANDARD_GRAVITY_MM_S2} mm/s². Raise it for a shock or
            manoeuvre load — 10× is a 10 g case.
          </p>
        </>
      )}

      {load.type === "centrifugal" && (
        <>
          <VectorField
            label="A point on the axis"
            unit="mm"
            value={load.axis_point}
            onChange={(axis_point) => onChange({ ...load, axis_point })}
          />
          <VectorField
            label="Axis direction"
            value={load.axis_direction}
            onChange={(axis_direction) => onChange({ ...load, axis_direction })}
          />
          <Input
            id={`${load.id}-rpm`}
            label="Speed (rpm)"
            type="number"
            step="any"
            min="0"
            value={String(load.rpm)}
            onChange={(event) => onChange({ ...load, rpm: Number(event.target.value) || 0 })}
          />
          <p className="text-xs text-muted">
            The load grows with the square of the speed: doubling the rpm quadruples it.
          </p>
        </>
      )}
    </fieldset>
  );
}
