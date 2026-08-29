import { forwardRef } from "react";

/**
 * The small rounded control in the composer tray and the conversation header.
 *
 * Wraps the `.k-pill` component class from `globals.css` so the toggled state
 * is expressed once, as `data-active`, rather than as a different string of
 * Tailwind utilities at every call site.
 */
interface PillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Renders the toggled treatment and sets `aria-pressed`. */
  active?: boolean;
  /** A pill that only reports state (the CATIA chip) rather than toggling one. */
  role?: "toggle" | "status";
}

export const Pill = forwardRef<HTMLButtonElement, PillProps>(function Pill(
  { active = false, role = "toggle", className = "", children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-active={active ? "true" : "false"}
      {...(role === "toggle" ? { "aria-pressed": active } : {})}
      className={`k-pill ${className}`}
      {...props}
    >
      {children}
    </button>
  );
});
