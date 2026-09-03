"use client";

import { VectorField } from "@/components/simulate/vector-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SELECTOR_LABELS, defaultSelector } from "@/lib/load-case";
import type { Selector, SelectorType } from "@/types/api";

interface SelectorFieldsProps {
  value: Selector;
  onChange: (selector: Selector) => void;
  /** Which region kinds this load or fixture may use. */
  allowed: readonly SelectorType[];
}

const AXES = [
  { value: "x", label: "X" },
  { value: "y", label: "Y" },
  { value: "z", label: "Z" },
] as const;

const SIDES = [
  { value: "min", label: "Lowest" },
  { value: "max", label: "Highest" },
] as const;

/**
 * The fields for whichever region kind is selected.
 *
 * Switching kind replaces the selector wholesale rather than merging the two,
 * because the fields have no meaningful correspondence -- a face's axis is not
 * a cylinder's axis direction, and carrying values across would produce a
 * plausible-looking region nobody chose.
 */
export function SelectorFields({ value, onChange, allowed }: SelectorFieldsProps) {
  const options = allowed.map((type) => ({ value: type, label: SELECTOR_LABELS[type] }));

  return (
    <div className="flex flex-col gap-3">
      {options.length > 1 && (
        <Select
          label="Region"
          value={value.type}
          options={options}
          onChange={(event) => onChange(defaultSelector(event.target.value as SelectorType))}
        />
      )}

      {value.type === "face" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Axis"
            value={value.axis}
            options={AXES}
            onChange={(event) =>
              onChange({ ...value, axis: event.target.value as "x" | "y" | "z" })
            }
          />
          <Select
            label="Side"
            value={value.side}
            options={SIDES}
            onChange={(event) => onChange({ ...value, side: event.target.value as "min" | "max" })}
          />
        </div>
      )}

      {value.type === "box" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <VectorField
            label="Minimum corner"
            unit="mm"
            value={value.min}
            onChange={(min) => onChange({ ...value, min })}
          />
          <VectorField
            label="Maximum corner"
            unit="mm"
            value={value.max}
            onChange={(max) => onChange({ ...value, max })}
          />
        </div>
      )}

      {value.type === "cylinder" && (
        <div className="flex flex-col gap-3">
          <VectorField
            label="A point on the axis"
            unit="mm"
            value={value.axis_point}
            onChange={(axis_point) => onChange({ ...value, axis_point })}
          />
          <VectorField
            label="Axis direction"
            value={value.axis_direction}
            onChange={(axis_direction) => onChange({ ...value, axis_direction })}
            hint="Length is ignored; only the direction is used."
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              id="cylinder-radius"
              label="Radius (mm)"
              type="number"
              step="any"
              min="0"
              value={String(value.radius)}
              onChange={(event) => onChange({ ...value, radius: Number(event.target.value) || 0 })}
            />
            <Input
              id="cylinder-tolerance"
              label="Wall band (mm)"
              type="number"
              step="any"
              min="0"
              value={String(value.radius_tolerance ?? 0.5)}
              onChange={(event) =>
                onChange({ ...value, radius_tolerance: Number(event.target.value) || 0 })
              }
            />
            <Input
              id="cylinder-length"
              label="Length (mm, optional)"
              type="number"
              step="any"
              min="0"
              placeholder="Full"
              value={value.length == null ? "" : String(value.length)}
              onChange={(event) =>
                onChange({
                  ...value,
                  length: event.target.value === "" ? null : Number(event.target.value),
                })
              }
            />
          </div>
          <p className="text-xs text-muted">
            Selects the wall of a hole or shaft — the band of material within the tolerance
            of that radius, not the solid disc inside it.
          </p>
        </div>
      )}

      {value.type === "sphere" && (
        <div className="flex flex-col gap-3">
          <VectorField
            label="Centre"
            unit="mm"
            value={value.centre}
            onChange={(centre) => onChange({ ...value, centre })}
          />
          <Input
            id="sphere-radius"
            label="Radius (mm)"
            type="number"
            step="any"
            min="0"
            value={String(value.radius)}
            onChange={(event) => onChange({ ...value, radius: Number(event.target.value) || 0 })}
          />
        </div>
      )}

      {value.type === "body" && (
        <p className="text-xs text-muted">Applies to every element in the part.</p>
      )}
    </div>
  );
}
