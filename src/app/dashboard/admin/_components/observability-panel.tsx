import {
  failureNote,
  formatMicroUsd,
  formatMillis,
  formatSeconds,
  slowestFirst,
  tailLabel,
} from "@/lib/observability";
import type { Observability } from "@/types/api";

import { AiCachePanel } from "./ai-cache-panel";

/**
 * Where the time and the money go (ROAD_TO_10 9.6).
 *
 * Each block says what it is a view of. The span table is **one worker's memory** and the
 * server's own sentence is printed above it; turn cost, bridge latency and the queue are read
 * from rows and cover every worker. A tail figure that is really a maximum is labelled so, and
 * a turn with no price is counted apart rather than shown as free.
 */
export function ObservabilityPanel({ data }: { data: Observability }) {
  const sites = slowestFirst(data.spans.sites);
  const operations = slowestFirst(data.bridge.operations);
  const queued = Object.entries(data.queue_depth).filter(([, count]) => count > 0);

  return (
    <section className="space-y-6" data-testid="observability-panel">
      <h2 className="text-sm font-semibold">Time and cost</h2>

      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted">Timed sites</h3>
        <p className="text-xs text-muted">{data.spans.scope}</p>
        {sites.length === 0 ? (
          <p className="text-sm text-muted">Nothing timed on this worker yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">Site</th>
                <th className="py-1 pr-3 font-medium">Median</th>
                <th className="py-1 pr-3 font-medium">Tail</th>
                <th className="py-1 pr-3 font-medium">Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sites.map((site) => (
                <tr key={site.name}>
                  <td className="py-1 pr-3 font-mono text-xs">{site.name}</td>
                  <td className="py-1 pr-3 font-mono">{formatSeconds(site.median_seconds)}</td>
                  <td className="py-1 pr-3 font-mono">
                    {formatSeconds(site.p95_seconds)}{" "}
                    <span className="text-xs text-muted">
                      {tailLabel(site.p95_is_the_maximum)}
                    </span>
                  </td>
                  <td className="py-1 pr-3 text-muted">
                    {site.seen.toLocaleString("en-US")}
                    {failureNote(site.failures, site.seen) && (
                      <span className="ml-2 text-danger">
                        {failureNote(site.failures, site.seen)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted">Agent turns, last {data.window_hours} h</h3>
        {data.turns.turns === 0 ? (
          <p className="text-sm text-muted">No agent turns in this window.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            <li>
              {data.turns.turns.toLocaleString("en-US")} turns, total{" "}
              <span className="font-mono">{formatMicroUsd(data.turns.total_micro_usd)}</span>
              {data.turns.mean_micro_usd !== null && (
                <>
                  , mean <span className="font-mono">{formatMicroUsd(data.turns.mean_micro_usd)}</span>{" "}
                  and largest{" "}
                  <span className="font-mono">{formatMicroUsd(data.turns.max_micro_usd)}</span> per
                  priced turn
                </>
              )}
              .
            </li>
            {data.turns.unpriced_turns > 0 && (
              <li className="text-warning">
                {data.turns.unpriced_turns.toLocaleString("en-US")} turns have no configured price
                and are not in that total.
              </li>
            )}
            {data.turns.median_wall_ms !== null && data.turns.p95_wall_ms !== null && (
              <li className="text-muted">
                Wall time: median {formatMillis(data.turns.median_wall_ms)}, p95{" "}
                {formatMillis(data.turns.p95_wall_ms)}.
              </li>
            )}
            <li className="text-muted">
              Ended by:{" "}
              {Object.entries(data.turns.by_stop_reason)
                .map(([reason, count]) => `${reason} ${count}`)
                .join(", ")}
            </li>
          </ul>
        )}
      </div>

      <AiCachePanel cache={data.ai_cache} />

      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted">Queue</h3>
        <p className="text-sm">
          {queued.length === 0
            ? "No runs are queued or running."
            : queued.map(([status, count]) => `${status} ${count}`).join(", ")}
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted">CATIA operations (by tool)</h3>
        {operations.length === 0 ? (
          <p className="text-sm text-muted">No CATIA operations in this window.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">Tool</th>
                <th className="py-1 pr-3 font-medium">Median</th>
                <th className="py-1 pr-3 font-medium">Tail</th>
                <th className="py-1 pr-3 font-medium">Calls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {operations.map((operation) => (
                <tr key={operation.tool}>
                  <td className="py-1 pr-3 font-mono text-xs">{operation.tool}</td>
                  <td className="py-1 pr-3 font-mono">{formatMillis(operation.median_ms)}</td>
                  <td className="py-1 pr-3 font-mono">
                    {formatMillis(operation.p95_ms)}{" "}
                    <span className="text-xs text-muted">
                      {tailLabel(operation.p95_is_the_maximum)}
                    </span>
                  </td>
                  <td className="py-1 pr-3 text-muted">
                    {operation.count.toLocaleString("en-US")}
                    {failureNote(operation.failures, operation.count) && (
                      <span className="ml-2 text-danger">
                        {failureNote(operation.failures, operation.count)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data.bridge.truncated && (
          <p className="text-xs text-muted">
            The window held more operations than were read; these figures are for the newest.
          </p>
        )}
      </div>
    </section>
  );
}
