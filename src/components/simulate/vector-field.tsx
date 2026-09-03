"use client";

import { Input } from "@/components/ui/input";

interface VectorFieldProps {
  label: string;
  /** The unit shown after the label, e.g. "N", "mm". Omit for a direction. */
  unit?: string;
  value: readonly [number, number, number];
  onChange: (value: [number, number, number]) => void;
  hint?: string;
}

const AXES = ["X", "Y", "Z"] as const;

/**
 * Three numeric inputs for an (x, y, z) triple.
 *
 * The empty string is treated as zero rather than as invalid. Clearing a field
 * to retype it is the commonest thing a user does, and rejecting the
 * intermediate state means the form flashes an error on every edit -- the real
 * validation is `validateLoadCase`, which runs on the assembled case and can
 * say something useful like "a force of zero applies nothing".
 */
export function VectorField({ label, unit, value, onChange, hint }: VectorFieldProps) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium text-muted">
        {label}
        {unit ? ` (${unit})` : ""}
      </legend>
      <div className="grid grid-cols-3 gap-2">
        {AXES.map((axis, index) => (
          <Input
            key={axis}
            id={`${label}-${axis}`}
            label={axis}
            type="number"
            step="any"
            value={String(value[index])}
            onChange={(event) => {
              const next: [number, number, number] = [...value] as [number, number, number];
              next[index] = Number(event.target.value) || 0;
              onChange(next);
            }}
          />
        ))}
      </div>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </fieldset>
  );
}
