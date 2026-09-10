import { forwardRef } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

/**
 * A labelled text input.
 *
 * `className` is **merged**, not replaced. It used to be set before
 * `{...props}` was spread, so passing one silently overwrote the whole string —
 * the field kept its label and lost its border, height, focus ring and
 * placeholder colour, with nothing to indicate why. `Button` had always merged;
 * two primitives in one barrel disagreeing about this is exactly the sort of
 * thing that is discovered by a page looking subtly wrong. Found 2026-09-10
 * while adding a `w-24` to a number field in the operations console.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, id, className = "", ...props },
  ref,
) {
  return (
    <label className="flex flex-col gap-1.5 text-sm" htmlFor={id}>
      <span className="font-medium text-muted">{label}</span>
      <input
        ref={ref}
        id={id}
        className={`h-10 rounded-md border border-border bg-surface px-3 text-accent outline-none transition-shadow placeholder:text-muted/60 focus:border-primary focus:shadow-[0_0_0_3px_rgb(37_99_235/0.12)] ${className}`}
        {...props}
      />
    </label>
  );
});
