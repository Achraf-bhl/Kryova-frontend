import type { AiCacheHealth } from "@/types/api";

/**
 * Whether the prompt cache is working (ROAD_TO_10 1.11).
 *
 * On a hosted model the cache is what makes the bill small, and nothing errors when it
 * stops working — a timestamp slipping ahead of the transcript just bills every step at
 * the full price. Three states are kept apart on purpose, because rendering them as one
 * number is how a dead cache goes unnoticed:
 *
 * - no turns in the window: a sentence, not 0%;
 * - the provider reports no cached counts: the rate is *unmeasured*, not zero;
 * - a rate, with the recent stretch beside it and the server's alert above it.
 */
export function AiCachePanel({ cache }: { cache: AiCacheHealth }) {
  return (
    <div className="space-y-3" data-testid="ai-cache-panel">
      <h3 className="text-xs font-medium text-muted">Prompt cache</h3>

      {cache.alert && (
        <p
          role="alert"
          className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-accent"
        >
          {cache.alert}
        </p>
      )}

      {cache.turns === 0 ? (
        <p className="text-sm text-muted">No agent turns in this window yet.</p>
      ) : !cache.reported ? (
        <p className="text-sm text-muted">
          The model provider does not report cached tokens, so the hit rate is not measured
          here — {cache.turns} turns, {formatTokens(cache.prompt_tokens)} input tokens, all
          counted at the full price.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <Figure
            label="Hit rate"
            value={percent(cache.hit_rate)}
            detail={`${formatTokens(cache.cached_prompt_tokens)} of ${formatTokens(
              cache.prompt_tokens,
            )} input tokens at the cache price`}
          />
          <Figure
            label={`Last ${cache.recent_turns} turns`}
            value={percent(cache.recent_hit_rate)}
            muted={cache.recent_hit_rate === null}
            detail={
              cache.recent_hit_rate === null
                ? "too few turns to compare"
                : "compared against everything earlier in the window"
            }
          />
          <Figure label="Turns" value={String(cache.turns)} detail="with a model call" />
        </div>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  detail,
  muted = false,
}: {
  label: string;
  value: string;
  detail: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 font-mono text-lg ${muted ? "text-muted" : "text-accent"}`}>
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted">{detail}</p>
    </div>
  );
}

/** null is "not measured", never "0%". */
export function percent(rate: number | null): string {
  return rate === null ? "not enough turns" : `${Math.round(rate * 100)}%`;
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}
