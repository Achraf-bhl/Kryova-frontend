"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import type { VerificationStatus } from "@/types/api";

/**
 * "Confirm your email address", with a resend that respects the throttle
 * (P1.5).
 *
 * Renders **nothing** when the address is already confirmed, which is why it is
 * safe to place unconditionally. A banner every user sees forever is furniture,
 * the same argument `conversation-resume` makes about the resume notice.
 *
 * Two things it will not do:
 *
 * - It does not claim a message was sent when this deployment cannot send one.
 *   `delivery_available` is false on any build without an SMTP transport, and a
 *   resend button that reports success into a log file is worse than no button.
 * - It does not block anything. Verification gates *project creation* on the
 *   backend and nothing else, so this is an explanation, not a wall.
 */
export function VerifyEmailNotice({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .verificationStatus()
      .then(setStatus)
      // Silent: this is an advisory banner, and a user who cannot reach the
      // status endpoint has bigger problems being reported elsewhere.
      .catch(() => setStatus(null));
  }, []);

  useEffect(load, [load]);

  if (!status || status.verified) return null;

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      const next = await api.resendVerification();
      setStatus(next);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the email");
    } finally {
      setBusy(false);
    }
  }

  const waiting = status.can_resend_in_seconds > 0;

  return (
    <div
      role="status"
      className={`rounded-md border border-warning/40 bg-warning/5 ${compact ? "px-3 py-2" : "p-4"}`}
    >
      <p className="text-sm font-medium text-accent">Confirm your email address</p>
      <p className="mt-1 max-w-prose text-sm text-muted">
        {status.delivery_available
          ? "We sent you a link when you signed up. Until you open it you can use Kryova, but you cannot create a project."
          : "This Kryova cannot send email, so the confirmation link never went out. Ask an administrator to confirm your address — until then you can use Kryova but cannot create a project."}
      </p>
      {status.delivery_available && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            className="h-8 px-3 text-xs"
            loading={busy}
            disabled={waiting}
            onClick={resend}
          >
            Send it again
          </Button>
          {sent && !waiting && <span className="text-xs text-muted">Sent.</span>}
          {waiting && (
            <span className="text-xs text-muted">
              You can ask again in {status.can_resend_in_seconds}s.
            </span>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
