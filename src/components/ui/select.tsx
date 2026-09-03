import { forwardRef } from "react";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string = string>
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  label: string;
  options: ReadonlyArray<SelectOption<T>>;
  /** Shown above the options, for "no choice yet" or "use the default". */
  placeholder?: string;
}

/**
 * A labelled `<select>`, styled to match `Input`.
 *
 * Every page that needed a dropdown had been repeating the same class string
 * inline. The classes are the same ones `Input` carries, minus the ones that
 * only make sense on a text field, so the two line up on a row without anyone
 * having to remember to keep them matching.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, placeholder, id, ...props },
  ref,
) {
  return (
    <label className="flex flex-col gap-1.5 text-sm" htmlFor={id}>
      <span className="font-medium text-muted">{label}</span>
      <select
        ref={ref}
        id={id}
        className="h-10 rounded-md border border-border bg-surface px-3 text-accent outline-none transition-shadow focus:border-primary focus:shadow-[0_0_0_3px_rgb(37_99_235/0.12)]"
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
});
