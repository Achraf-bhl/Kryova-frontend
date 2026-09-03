"use client";

import { SelectorFields } from "@/components/simulate/selector-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FIXTURE_KIND_LABELS, impliedDofs, type FixtureRow } from "@/lib/load-case";
import type { FixtureKind, SelectorType } from "@/types/api";

const KIND_OPTIONS = (Object.keys(FIXTURE_KIND_LABELS) as FixtureKind[]).map((kind) => ({
  value: kind,
  label: FIXTURE_KIND_LABELS[kind],
}));

const AXIS_OPTIONS = [
  { value: "x", label: "X" },
  { value: "y", label: "Y" },
  { value: "z", label: "Z" },
] as const;

const ALLOWED: SelectorType[] = ["face", "box", "cylinder", "sphere"];

interface FixtureEditorProps {
  fixture: FixtureRow;
  index: number;
  onChange: (fixture: FixtureRow) => void;
  onRemove: () => void;
  removable: boolean;
}

/**
 * One restraint.
 *
 * The dof checkboxes appear only for a `custom` fixture. For every other kind
 * the axes are derived, and showing them as editable would invite a value that
 * disagrees with the kind -- which the server refuses, correctly, but only
 * after a round trip.
 */
export function FixtureEditor({
  fixture,
  index,
  onChange,
  onRemove,
  removable,
}: FixtureEditorProps) {
  const kind = fixture.kind ?? "custom";
  const derived = impliedDofs(kind, fixture.normal);
  const needsNormal = kind === "roller" || kind === "slider" || kind === "symmetry";

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <legend className="text-sm font-semibold">Fixture {index + 1}</legend>
        {removable && (
          <Button type="button" variant="secondary" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          id={`${fixture.id}-name`}
          label="Name (optional)"
          value={fixture.name ?? ""}
          placeholder="e.g. bolted base"
          onChange={(event) => onChange({ ...fixture, name: event.target.value })}
        />
        <Select
          label="Restraint"
          value={kind}
          options={KIND_OPTIONS}
          onChange={(event) => {
            const next = event.target.value as FixtureKind;
            onChange({
              ...fixture,
              kind: next,
              // `dofs` only travels with a custom fixture; the server derives it
              // for the rest and rejects a value that contradicts the kind.
              dofs: next === "custom" ? (fixture.dofs ?? ["x", "y", "z"]) : undefined,
              normal: next === "clamp" || next === "custom" ? undefined : (fixture.normal ?? "z"),
            });
          }}
        />
      </div>

      {needsNormal && (
        <Select
          label="Axis it holds"
          value={fixture.normal ?? "z"}
          options={AXIS_OPTIONS}
          onChange={(event) =>
            onChange({ ...fixture, normal: event.target.value as "x" | "y" | "z" })
          }
        />
      )}

      {kind === "custom" ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium text-muted">Axes held</legend>
          <div className="flex gap-4">
            {AXIS_OPTIONS.map((axis) => (
              <label key={axis.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={(fixture.dofs ?? []).includes(axis.value)}
                  onChange={(event) => {
                    const held = new Set(fixture.dofs ?? []);
                    if (event.target.checked) held.add(axis.value);
                    else held.delete(axis.value);
                    onChange({
                      ...fixture,
                      dofs: (["x", "y", "z"] as const).filter((a) => held.has(a)),
                    });
                  }}
                />
                {axis.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        derived && (
          <p className="text-xs text-muted">
            Holds {derived.map((axis) => axis.toUpperCase()).join(", ")}.
          </p>
        )
      )}

      <SelectorFields
        value={fixture.where}
        allowed={ALLOWED}
        onChange={(where) => onChange({ ...fixture, where })}
      />
    </fieldset>
  );
}
