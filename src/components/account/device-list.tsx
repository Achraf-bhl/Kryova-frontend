"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import type { DeviceSession } from "@/types/api";

/**
 * Every device this account is signed in on, and a way to end any of them
 * (P1.3).
 *
 * **The row is the truth, not the cookie.** A device signed out from here stops
 * working immediately because the session row backing its refresh-token family
 * is revoked — that is what makes this feature worth having rather than a list
 * that looks reassuring. The backing is `core/sessions.py`, shipped in P1.1.
 *
 * Nothing here carries a token or a hash of one: `DeviceSession` is the whole
 * payload, and nothing in it is useful to somebody who has it.
 */
export function DeviceList() {
  const router = useRouter();
  const [devices, setDevices] = useState<DeviceSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listDevices()
      .then(setDevices)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  async function end(sessionId: string) {
    setBusy(sessionId);
    setError(null);
    try {
      await api.endDevice(sessionId);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign that device out");
    } finally {
      setBusy(null);
    }
  }

  async function endEverywhere() {
    setBusy("all");
    setError(null);
    try {
      await api.signOutEverywhere();
      // `replace`, not `push`: this device is signed out too, so the dashboard
      // behind us is no longer reachable and leaving it in history means the
      // back button lands on a page that can only fail. `refresh` discards the
      // cached RSC payload rendered against the session that just ended.
      router.replace("/login");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign out everywhere");
      setBusy(null);
    }
  }

  if (error && !devices) {
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    );
  }
  if (!devices) return <p className="text-sm text-muted">Checking…</p>;

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
        {devices.map((device) => (
          <li key={device.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {device.device_label ?? "Unrecognised device"}
                {device.current && (
                  <span className="ml-2 rounded-sm bg-primary-soft px-1.5 py-0.5 text-xs font-normal text-primary">
                    this device
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {device.ip_address ?? "address not recorded"} · last used{" "}
                {relativeTime(device.last_used_at)}
              </p>
            </div>
            <Button
              variant="secondary"
              className="h-8 px-3 text-xs"
              loading={busy === device.id}
              onClick={() => end(device.id)}
            >
              {device.current ? "Sign out" : "Sign out this device"}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="danger" loading={busy === "all"} onClick={endEverywhere}>
          Sign out everywhere
        </Button>
        <p className="text-xs text-muted">
          Ends every session including this one. Use this if you think somebody else has
          access to your account.
        </p>
      </div>
    </div>
  );
}
