import Link from "next/link";
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

/**
 * The shape both the button and the link wear. Extracted so the two cannot
 * drift: a "button" that is really a link used to be hand-rolled Tailwind at
 * each call site, and three of them had three different heights.
 */
function buttonClasses(variant: Variant, className: string): string {
  return (
    "inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm " +
    "font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 " +
    `${variantClasses[variant]} ${className}`
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", loading, children, className = "", disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled ?? loading}
      className={buttonClasses(variant, className)}
      {...props}
    >
      {loading && (
        <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
});

interface ButtonLinkProps extends React.ComponentPropsWithoutRef<typeof Link> {
  variant?: Variant;
}

/**
 * A navigation that looks like a button.
 *
 * A real `<a>`, not a `<button>` with an `onClick` that pushes — so
 * middle-click, ctrl-click, "copy link address" and a screen reader announcing
 * "link" all work. Added rather than an `asChild` prop because `asChild` needs
 * slot-cloning machinery for one case, and this repo's three-dependency rule
 * means that machinery would be hand-written too.
 */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  function ButtonLink({ variant = "primary", className = "", children, ...props }, ref) {
    return (
      <Link ref={ref} className={buttonClasses(variant, className)} {...props}>
        {children}
      </Link>
    );
  },
);
