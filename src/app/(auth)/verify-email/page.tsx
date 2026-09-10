"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { ButtonLink } from "@/components/ui/button";
import { api } from "@/lib/api-client";

/**
 * Where the confirmation link in the verification email lands (P1.5).
 *
 * In the unauthenticated route group on purpose: a mail client hands the link
 * to whichever browser it likes, which is routinely not the one holding the
 * session. The token is the credential, so this page needs no sign-in — and
 * putting it behind one would bounce the user to a login screen that then
 * discards the `?token=` on its way to the dashboard.
 *
 * `useSearchParams` is why the Suspense boundary is here; see the login page
 * for the same pattern and the same build-time reason.
 */
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<Heading />}>
      <Confirmation />
    </Suspense>
  );
}

function Heading() {
  return (
    <div>
      <h1 className="font-display text-xl font-semibold">Confirming your address</h1>
      <p className="mt-1 text-sm text-muted">One moment.</p>
    </div>
  );
}

type State =
  | { status: "working" }
  | { status: "done"; email: string }
  | { status: "failed"; message: string };

function Confirmation() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  // A missing token needs no request and no effect — it is derived from the
  // URL during render. Only the network call belongs in an effect.
  const [state, setState] = useState<State>(() =>
    token
      ? { status: "working" }
      : {
          status: "failed",
          message:
            "That link is missing its confirmation code. Copy the whole link from the email.",
        },
  );
  // React runs effects twice in development's strict mode, and this token is
  // single-use: the second call is guaranteed to fail and would show the user
  // "invalid link" for a link that had just worked.
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current || !token) return;
    attempted.current = true;
    api
      .confirmEmail(token)
      .then((user) => setState({ status: "done", email: user.email }))
      .catch((error: Error) => setState({ status: "failed", message: error.message }));
  }, [token]);

  if (state.status === "working") return <Heading />;

  if (state.status === "done") {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-display text-xl font-semibold">Address confirmed</h1>
          <p className="mt-1 text-sm text-muted">
            <span className="font-medium text-accent">{state.email}</span> is confirmed. You can
            create projects now.
          </p>
        </div>
        <ButtonLink href="/dashboard">Go to Kryova</ButtonLink>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold">That link did not work</h1>
        <p className="mt-1 text-sm text-muted">{state.message}</p>
      </div>
      {/* A confirmation link works once and expires, so the recovery is always
          the same: sign in and ask for another. Saying so beats leaving the
          user to guess whether to try the link again. */}
      <p className="text-sm text-muted">
        Confirmation links can only be used once and expire after a day. Sign in and ask for a
        new one from Settings.
      </p>
      <ButtonLink href="/login">Sign in</ButtonLink>
    </div>
  );
}
