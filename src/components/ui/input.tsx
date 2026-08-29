import { forwardRef } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, id, ...props },
  ref,
) {
  return (
    <label className="flex flex-col gap-1.5 text-sm" htmlFor={id}>
      <span className="font-medium text-muted">{label}</span>
      <input
        ref={ref}
        id={id}
        className="h-10 rounded-md border border-border bg-surface px-3 text-accent outline-none transition-shadow placeholder:text-muted/60 focus:border-primary focus:shadow-[0_0_0_3px_rgb(37_99_235/0.12)]"
        {...props}
      />
    </label>
  );
});
