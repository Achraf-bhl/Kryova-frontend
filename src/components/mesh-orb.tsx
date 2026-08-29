/**
 * The mark: a meshed sphere carrying the stress ramp.
 *
 * `.k-orb` in `globals.css` paints the body; this adds the wireframe over it,
 * which is the whole point of the mark — Kryova meshes a part and colours it by
 * stress, so the brand is a *mesh*, not a gradient blob. Latitudes and meridians
 * are generated rather than hand-drawn so the density can follow the size: a
 * 28 px indicator with twelve meridians is a smudge.
 *
 * `data-state="working"` warms the body toward the amber end of the ramp while
 * the agent runs, so the motion reports something true. Reduced motion is
 * handled in `globals.css` — the orb keeps its colour and stops spinning.
 *
 * Entirely decorative: the live region in the chat view is what announces
 * state to a screen reader, so this is `aria-hidden` throughout.
 */

const RADIUS = 48;
const CENTRE = 50;

function meridians(count: number): number[] {
  // Half-turn swept in `count` steps; each is an ellipse whose x-radius is the
  // cosine of its angle, which is what a great circle looks like edge-on.
  return Array.from({ length: count }, (_, index) => (Math.PI * index) / count);
}

function latitudes(count: number): number[] {
  // Skip the poles: an ellipse of zero radius renders as nothing but still
  // costs a node.
  return Array.from({ length: count }, (_, index) => (Math.PI * (index + 1)) / (count + 1));
}

export interface MeshOrbProps {
  /** Tailwind sizing, e.g. `h-32 w-32`. */
  className?: string;
  /** True while the agent is running a turn. */
  working?: boolean;
  /** Fewer lines for a small indicator, more for the hero. */
  density?: "fine" | "coarse";
}

export function MeshOrb({ className = "h-32 w-32", working = false, density = "fine" }: MeshOrbProps) {
  const meridianCount = density === "fine" ? 9 : 5;
  const latitudeCount = density === "fine" ? 6 : 3;

  return (
    <div
      className={`k-orb ${className}`}
      data-state={working ? "working" : "idle"}
      aria-hidden="true"
    >
      <svg className="k-orb-mesh" viewBox="0 0 100 100" fill="none" aria-hidden="true">
        <g stroke="white" strokeWidth="0.6" opacity="0.85">
          <circle cx={CENTRE} cy={CENTRE} r={RADIUS} />
          {meridians(meridianCount).map((angle) => (
            <ellipse
              key={`m-${angle.toFixed(3)}`}
              cx={CENTRE}
              cy={CENTRE}
              rx={Math.abs(RADIUS * Math.cos(angle))}
              ry={RADIUS}
            />
          ))}
          {latitudes(latitudeCount).map((angle) => (
            <ellipse
              key={`l-${angle.toFixed(3)}`}
              cx={CENTRE}
              cy={CENTRE - RADIUS * Math.cos(angle)}
              rx={RADIUS * Math.sin(angle)}
              // Flattened by the same factor a sphere's parallels are when you
              // look at it from the equator.
              ry={RADIUS * Math.sin(angle) * 0.22}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
