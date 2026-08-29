"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CheckIcon, CopyIcon, TrashIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import type { CatiaDevice, CatiaDeviceCreated } from "@/types/catia";

const PAIRING_POLL_MS = 3_000;

/** Copy-to-clipboard that reports success in place, and says so if it can't. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setFailed(false);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard access is denied outside a secure context, which is
          // exactly where a self-hosted Kryova often runs. Say so; the value is
          // on screen and can be selected by hand.
          setFailed(true);
        }
      }}
      className="k-pill shrink-0"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      {failed ? "Select it manually" : copied ? "Copied" : "Copy"}
    </button>
  );
}

function relativeExpiry(iso: string): string {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (Number.isNaN(minutes)) return "";
  if (minutes <= 0) return "expired";
  return `expires in ${minutes} min`;
}

/**
 * Pair and manage the Windows workstations that run CATIA.
 *
 * The daemon dials out to the backend, so pairing is a code the user carries
 * from this screen to that machine — there is no host or port to type, and
 * nothing here ever talks to the workstation directly.
 */
export function CatiaDeviceManager() {
  const [devices, setDevices] = useState<CatiaDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [pairing, setPairing] = useState<CatiaDeviceCreated | null>(null);
  const [paired, setPaired] = useState<string | null>(null);
  const pairingRef = useRef<CatiaDeviceCreated | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listCatiaDevices();
      setDevices(list);
      setError(null);

      // Pairing succeeded the moment the daemon redeems the code, which happens
      // on the other machine — this is the only way this screen finds out.
      const pending = pairingRef.current;
      if (pending) {
        const match = list.find((device) => device.id === pending.device.id);
        if (match && match.status === "active") {
          pairingRef.current = null;
          setPairing(null);
          setPaired(match.name);
        }
      }
    } catch (err) {
      setDevices([]);
      setError(
        err instanceof Error
          ? err.message
          : "Could not load your workstations. Check that the Kryova API is reachable.",
      );
    }
  }, []);

  useEffect(() => {
    // Deferred by a microtask so the fetch is not kicked off synchronously
    // inside the effect body — same shape the old bridge hook used, and what
    // `react-hooks/set-state-in-effect` is asking for.
    void Promise.resolve().then(load);
  }, [load]);

  // Only poll while a code is outstanding; there is nothing to watch otherwise.
  useEffect(() => {
    if (!pairing) return;
    const interval = window.setInterval(() => void load(), PAIRING_POLL_MS);
    return () => window.clearInterval(interval);
  }, [pairing, load]);

  async function createDevice(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    setPaired(null);
    try {
      const created = await api.createCatiaDevice(name.trim());
      pairingRef.current = created;
      setPairing(created);
      setName("");
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Kryova could not issue a pairing code just now.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function revoke(device: CatiaDevice): Promise<void> {
    try {
      await api.revokeCatiaDevice(device.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That workstation could not be revoked.");
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {paired && (
        <p className="rounded-md border border-live/40 bg-live/5 px-3 py-2 text-sm text-accent">
          <strong className="font-medium">{paired}</strong> is paired. Ask a chat to build
          something and it will drive CATIA on that machine.
        </p>
      )}

      {pairing ? (
        <div className="k-panel space-y-4 p-4">
          <div>
            <h3 className="text-sm font-semibold text-accent">
              Finish pairing “{pairing.device.name}”
            </h3>
            <p className="mt-1 text-sm text-muted">
              On the Windows machine that runs CATIA, install the Kryova bridge and run the
              command below. This screen notices as soon as it connects.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-md border border-border-strong bg-surface-sunken px-4 py-2 font-mono text-2xl tracking-[0.3em] text-blueprint">
              {pairing.pairing_code}
            </span>
            <CopyButton value={pairing.pairing_code} label="pairing code" />
            <span className="font-mono text-xs text-faint">
              {relativeExpiry(pairing.pairing_expires_at)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <code className="k-scroll min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border border-border bg-surface-sunken px-3 py-2 font-mono text-xs text-accent">
              {pairing.command}
            </code>
            <CopyButton value={pairing.command} label="command" />
          </div>

          <div className="flex items-center gap-3">
            <span className="size-2 rounded-full bg-warning k-pulse" aria-hidden="true" />
            <p aria-live="polite" className="text-xs text-muted">
              Waiting for the workstation to connect…
            </p>
            <button
              type="button"
              onClick={() => {
                pairingRef.current = null;
                setPairing(null);
              }}
              className="ml-auto text-xs text-muted underline-offset-2 hover:text-accent hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={createDevice} className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Input
              id="device-name"
              label="Workstation name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Office desktop"
              required
            />
          </div>
          <Button type="submit" loading={creating} disabled={!name.trim()}>
            Get a pairing code
          </Button>
        </form>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-accent">Paired workstations</h3>
        {devices === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-muted">
            None yet. Pair the machine that runs CATIA and the agent can model on it.
          </p>
        ) : (
          <ul className="k-panel divide-y divide-border">
            {devices.map((device) => (
              <li key={device.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <span
                  className={`size-2 shrink-0 rounded-full ${
                    device.online ? "bg-live" : "bg-border-strong"
                  }`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-accent">{device.name}</span>
                  <span className="block truncate font-mono text-xs text-faint">
                    {device.hostname ?? "hostname unknown"}
                    {device.catia_version ? ` · ${device.catia_version}` : ""}
                    {device.is_mock ? " · mock" : ""}
                  </span>
                </span>
                <span className="font-mono text-xs text-muted">
                  {device.online ? "online" : device.status}
                </span>
                {device.status !== "revoked" && (
                  <button
                    type="button"
                    onClick={() => void revoke(device)}
                    className="rounded-sm p-1.5 text-faint hover:text-danger"
                    aria-label={`Revoke ${device.name}`}
                    title="Revoke this workstation's access"
                  >
                    <TrashIcon className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
