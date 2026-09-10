"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import type { MfaEnrolment, MfaStatus } from "@/types/api";

/**
 * Turning the second factor on and off (P1.7).
 *
 * **The secret and the recovery codes are shown once, ever.** Nothing returns
 * them again, so this component keeps them on screen until the user explicitly
 * says they have saved them — a panel that vanished on the next render would be
 * a lockout with a nice animation.
 *
 * There is no QR image. Rendering one needs a QR encoder, which is a dependency
 * this repo does not take (three by doctrine), and a hand-written one is a few
 * hundred lines of Reed-Solomon for a field the user can also type. The
 * `otpauth://` URI is offered as a link — every authenticator app on a phone
 * registers that scheme — and the base32 secret is shown for typing in. When a
 * QR code is genuinely wanted, it belongs on the backend where a library is
 * already available, as an endpoint returning a PNG.
 */
export function TwoFactor() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [enrolment, setEnrolment] = useState<MfaEnrolment | null>(null);
  const [code, setCode] = useState("");
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .mfaStatus()
      .then(setStatus)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work");
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return error ? (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    ) : (
      <p className="text-sm text-muted">Checking…</p>
    );
  }

  // --- Setup in progress: the one moment the secret exists on screen --------
  if (enrolment) {
    return (
      <div className="k-panel space-y-4 p-4">
        <div>
          <h3 className="text-sm font-semibold">Add Kryova to your authenticator app</h3>
          <p className="mt-1 text-sm text-muted">
            Open the link on the device with your authenticator app, or type the key in by
            hand. Then enter the six-digit code it shows to finish.
          </p>
        </div>

        <a
          href={enrolment.provisioning_uri}
          className="inline-block rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-primary hover:border-border-strong"
        >
          Open in an authenticator app
        </a>

        <div>
          <p className="text-xs font-medium text-muted">Or type this key</p>
          <p className="mt-1 font-mono text-sm tracking-wider break-all">{enrolment.secret}</p>
        </div>

        <RecoveryCodes
          codes={enrolment.recovery_codes}
          note="Save these now. They are the only way in if you lose the phone, and they are not shown again."
        />

        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              setStatus(await api.confirmMfa(code.trim()));
              setEnrolment(null);
              setCode("");
            });
          }}
        >
          <Input
            id="mfa-confirm"
            label="Six-digit code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
            autoComplete="one-time-code"
          />
          <Button type="submit" loading={busy}>
            Turn on
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setEnrolment(null);
              setCode("");
            }}
          >
            Cancel
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  // --- On --------------------------------------------------------------------
  if (status.enabled) {
    return (
      <div className="space-y-3">
        <div className="k-panel flex flex-wrap items-center gap-3 p-4">
          <span className="h-2 w-2 rounded-full bg-live" aria-hidden="true" />
          <p className="flex-1 text-sm">
            Two-factor authentication is <span className="font-medium">on</span>.{" "}
            <span className="text-muted">
              {status.recovery_codes_remaining} recovery{" "}
              {status.recovery_codes_remaining === 1 ? "code" : "codes"} left.
            </span>
          </p>
        </div>
        {freshCodes && (
          <RecoveryCodes
            codes={freshCodes}
            note="Your previous recovery codes no longer work. Save these."
          />
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            loading={busy}
            onClick={() =>
              void run(async () => {
                const issued = await api.regenerateRecoveryCodes();
                setFreshCodes(issued.recovery_codes);
                load();
              })
            }
          >
            New recovery codes
          </Button>
        </div>
        <DisableForm
          busy={busy}
          onDisable={(entered) =>
            run(async () => {
              await api.disableMfa(entered);
              setFreshCodes(null);
              load();
            })
          }
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  // --- Off, or started and abandoned -----------------------------------------
  return (
    <div className="space-y-3">
      <p className="max-w-prose text-sm text-muted">
        A second factor means a stolen password is not enough to sign in. You will need an
        authenticator app on your phone.
        {status.pending && " You started setting this up and did not finish."}
      </p>
      <Button
        loading={busy}
        onClick={() => void run(async () => setEnrolment(await api.beginMfaEnrolment()))}
      >
        {status.pending ? "Start again" : "Set up two-factor authentication"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function RecoveryCodes({ codes, note }: { codes: string[]; note: string }) {
  return (
    <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
      <p className="text-xs font-medium text-accent">{note}</p>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
    </div>
  );
}

function DisableForm({
  busy,
  onDisable,
}: {
  busy: boolean;
  onDisable: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm text-muted hover:text-danger"
      >
        Turn off two-factor authentication
      </button>
    );
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void onDisable(code.trim()).then(() => {
          setCode("");
          setConfirming(false);
        });
      }}
    >
      {/* A code is required to turn it off, not just to turn it on: a hijacked
          session must not be able to remove the defence that exists for
          hijacked sessions. */}
      <Input
        id="mfa-disable"
        label="Current code or a recovery code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        required
        autoComplete="one-time-code"
      />
      <Button type="submit" variant="danger" loading={busy}>
        Turn off
      </Button>
      <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
        Keep it on
      </Button>
    </form>
  );
}
