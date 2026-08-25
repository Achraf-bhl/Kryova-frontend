import { forwardRef } from "react";

type Variant = "primary" | "secondary" | "danger";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary/90 shadow-card disabled:bg-primary/40",
  secondary:
    "bg-surface text-accent border border-border hover:border-muted/40 shadow-card",
  danger: "bg-danger text-white hover:bg-danger/90",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", loading, children, className = "", disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled ?? loading}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {loading && (
        <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
});
