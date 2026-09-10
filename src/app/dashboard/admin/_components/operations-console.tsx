"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { formatBytes, relativeTime } from "@/lib/format";
import type {
  Announcement,
  FeatureFlag,
  FleetHealth,
  MaintenanceWindow,
} from "@/types/api";

/**
 * Fleet health, feature flags, maintenance mode and announcements (P3.5–P3.7).
 *
 * **Renders nothing to a non-staff caller** rather than showing an error. Every
 * endpoint here is 404 for them by design — for an ordinary user the whole
 * `/admin` tree is simply not there — so the honest UI is an empty page, not a
 * "you are not allowed" notice that confirms the console exists.
 */
export function OperationsConsole() {
  const [health, setHealth] = useState<FleetHealth | null>(null);
  const [denied, setDenied] = useState(false);

  const load = useCallback(() => {
    api
      .fleetHealth()
      .then(setHealth)
      .catch((error: unknown) => {
        if ((error as { status?: number }).status === 404) setDenied(true);
      });
  }, []);

  useEffect(load, [load]);

  if (denied) {
    return <p className="text-sm text-muted">There is nothing here.</p>;
  }
  if (!health) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-10">
      <HealthSection health={health} onRefresh={load} />
      <MaintenanceSection />
      <AnnouncementSection />
      <FlagSection />
    </div>
  );
}

function HealthSection({
  health,
  onRefresh,
}: {
  health: FleetHealth;
  onRefresh: () => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-sm font-semibold text-accent">
          Fleet health · last {health.window_hours}h
        </h2>
        <Button variant="secondary" className="h-8 px-3 text-xs" onClick={onRefresh}>
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Success rate"
          // null is "no runs to judge", not 0%. Rendering them the same sends
          // somebody hunting an outage on a quiet night.
          value={
            health.success_rate === null
              ? "no runs"
              : `${(health.success_rate * 100).toFixed(0)}%`
          }
          muted={health.success_rate === null}
        />
        <Stat label="Queued" value={String(health.queue_depth.queued ?? 0)} />
        <Stat label="Running" value={String(health.queue_depth.running ?? 0)} />
        <Stat label="Live sessions" value={String(health.live_sessions)} />
        <Stat label="Storage" value={formatBytes(health.storage_bytes)} />
        <Stat
          label={`Added in ${health.window_hours}h`}
          value={formatBytes(health.storage_bytes_added_in_window)}
        />
        <Stat label="Users" value={String(health.users_total)} />
        <Stat
          label="Suspended"
          value={String(health.users_suspended)}
          muted={health.users_suspended === 0}
        />
      </div>

      {!health.mail_delivers && (
        <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-accent">
          This deployment cannot send email. Password resets, verification links and
          invitations are going nowhere.
        </p>
      )}

      {health.failures.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted">Most common failures</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
            {health.failures.map((failure) => (
              <li
                key={failure.reason}
                className="flex items-start gap-3 px-4 py-2 text-sm"
              >
                <span className="flex-1">{failure.reason}</span>
                <span className="font-mono text-muted">{failure.count}</span>
              </li>
            ))}
          </ul>
          {/* Shown, so a coarse grouping is not read as a classification. */}
          <p className="text-xs text-muted">Grouped {health.failure_grouping}.</p>
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 font-mono text-lg ${muted ? "text-muted" : "text-accent"}`}>
        {value}
      </p>
    </div>
  );
}

function MaintenanceSection() {
  const [window_, setWindow] = useState<MaintenanceWindow | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .readMaintenance()
      .then(setWindow)
      .catch(() => setWindow(null));
  }, []);

  useEffect(load, [load]);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-accent">Read-only mode</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Reads keep working. Mutations are refused with your message and a 503 — never an
          error page.
        </p>
      </div>
      {window_ ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning/5 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-accent">Read-only since {relativeTime(window_.started_at)}</p>
            <p className="mt-0.5 text-sm text-muted">{window_.message}</p>
          </div>
          <Button
            variant="secondary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.endMaintenance();
                load();
              } finally {
                setBusy(false);
              }
            }}
          >
            End maintenance
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api.startMaintenance({ reason, message });
              setReason("");
              setMessage("");
              load();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not start maintenance");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Input
            id="maint-reason"
            label="Internal note"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="migrating the primary database"
            required
          />
          <Input
            id="maint-message"
            label="What users are told"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Kryova is read-only for about an hour."
            required
          />
          <Button type="submit" variant="danger" loading={busy}>
            Go read-only
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function AnnouncementSection() {
  const [rows, setRows] = useState<Announcement[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .listAnnouncements()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  useEffect(load, [load]);

  const live = rows.filter((row) => !row.withdrawn_at);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-accent">Announcements</h2>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await api.publishAnnouncement({ message });
            setMessage("");
            load();
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input
          id="announce"
          label="Message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          required
        />
        <Button type="submit" loading={busy}>
          Publish
        </Button>
      </form>
      {live.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
          {live.map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="flex-1">{row.message}</span>
              <Button
                variant="secondary"
                className="h-8 px-3 text-xs"
                onClick={async () => {
                  await api.withdrawAnnouncement(row.id);
                  load();
                }}
              >
                Withdraw
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FlagSection() {
  const [rows, setRows] = useState<FeatureFlag[]>([]);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .listFlags()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  useEffect(load, [load]);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-accent">Feature flags</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Evaluated on the server and sent to the client, so the UI and the API always agree.
          A rollout percentage picks the same tenants every time — widening it only ever adds
          people.
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await api.createFlag({ key });
            setKey("");
            load();
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input
          id="flag-key"
          label="New flag"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="streaming-viewer"
          required
        />
        <Button type="submit" variant="secondary" loading={busy}>
          Add
        </Button>
      </form>
      {rows.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
          {rows.map((flag) => (
            <FlagRow key={flag.id} flag={flag} onChanged={load} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FlagRow({ flag, onChanged }: { flag: FeatureFlag; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function change(body: Parameters<typeof api.updateFlag>[1]) {
    setBusy(true);
    try {
      await api.updateFlag(flag.key, body);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm">{flag.key}</p>
        <p className="mt-0.5 text-xs text-muted">
          {flag.killed
            ? "killed — off for everybody, overrides included"
            : flag.enabled
              ? "on by default"
              : `off by default${flag.rollout_percentage ? `, ${flag.rollout_percentage}% rollout` : ""}`}
          {flag.overrides.length > 0 && ` · ${flag.overrides.length} override(s)`}
        </p>
      </div>
      <Input
        id={`rollout-${flag.id}`}
        label="Rollout %"
        type="number"
        min={0}
        max={100}
        defaultValue={flag.rollout_percentage}
        disabled={busy || flag.killed}
        onBlur={(event) =>
          void change({ rollout_percentage: Number(event.target.value) })
        }
        className="w-24"
      />
      <Button
        variant="secondary"
        className="h-8 px-3 text-xs"
        loading={busy}
        disabled={flag.killed}
        onClick={() => void change({ enabled: !flag.enabled })}
      >
        {flag.enabled ? "Turn off" : "Turn on"}
      </Button>
      <Button
        variant={flag.killed ? "secondary" : "danger"}
        className="h-8 px-3 text-xs"
        loading={busy}
        onClick={() => void change({ killed: !flag.killed })}
      >
        {flag.killed ? "Un-kill" : "Kill"}
      </Button>
    </li>
  );
}
