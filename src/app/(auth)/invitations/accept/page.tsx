"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import type { OrganisationMembership } from "@/types/api";

/**
 * Where the invitation email's link lands (P2.6).
 *
 * In the `(auth)` group but it *needs* a session, which is the awkward case
 * this page exists to handle well: the token identifies an organisation, and
 * the backend only accepts it for the signed-in user whose address it was sent
 * to. So a signed-out visitor must sign in — or register — **and come back with
 * the token still in hand**, which is why the sign-in link carries `?next=`
 * pointing at this page, query string and all.
 *
 * Getting that wrong is the whole failure mode: bouncing to `/login` and then
 * to `/dashboard` drops the token, the invitation is never accepted, and the
 * only symptom is a user insisting they clicked the link.
 */
export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={<Heading />}>
      <Acceptance />
    </Suspense>
  );
}

function Heading() {
  return (
    <div>
      <h1 className="font-display text-xl font-semibold">Joining a team</h1>
      <p className="mt-1 text-sm text-muted">One moment.</p>
    </div>
  );
}

type State =
  | { status: "working" }
  | { status: "joined"; organisation: OrganisationMembership }
  | { status: "needs-sign-in" }
  | { status: "failed"; message: string };

function Acceptance() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<State>(() =>
    token
      ? { status: "working" }
      : {
          status: "failed",
          message: "That link is missing its invitation code. Copy the whole link from the email.",
        },
  );
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current || !token) return;
    attempted.current = true;
    api
      .acceptInvitation(token)
      .then((organisation) => setState({ status: "joined", organisation }))
      .catch((error: unknown) => {
        // 401 means "sign in first", not "bad invitation" — and the difference
        // matters, because one of them is the user's problem to fix.
        const status = (error as { status?: number }).status;
        if (status === 401 || status === 403) {
          setState({ status: "needs-sign-in" });
          return;
        }
        setState({
          status: "failed",
          message: error instanceof Error ? error.message : "That invitation is not valid.",
        });
      });
  }, [token]);

  if (state.status === "working") return <Heading />;

  if (state.status === "joined") {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-display text-xl font-semibold">
            You are in {state.organisation.name}
          </h1>
          <p className="mt-1 text-sm text-muted">
            You joined as {state.organisation.role}
            {state.organisation.domain_role ? ` and ${state.organisation.domain_role}` : ""}.
          </p>
        </div>
        <Button onClick={() => router.push("/dashboard")}>Go to Kryova</Button>
      </div>
    );
  }

  if (state.status === "needs-sign-in") {
    // The token rides along in `next`, so signing in returns here rather than
    // to the dashboard. `safeRedirectPath` on the login page keeps that from
    // becoming an open redirect.
    const back = encodeURIComponent(`/invitations/accept?token=${token ?? ""}`);
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-display text-xl font-semibold">Sign in to accept</h1>
          <p className="mt-1 max-w-prose text-sm text-muted">
            This invitation was sent to a specific address, so we need to know it is you. Sign
            in — or create an account with the address the invitation was sent to — and you
            will come straight back here.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href={`/login?next=${back}`}>Sign in</ButtonLink>
          <ButtonLink href={`/register?next=${back}`} variant="secondary">
            Create an account
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold">That invitation did not work</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">{state.message}</p>
      </div>
      <p className="text-sm text-muted">
        Invitations expire, can be withdrawn, and only work for the address they were sent to.
        Ask whoever invited you to send another.
      </p>
      <ButtonLink href="/dashboard">Go to Kryova</ButtonLink>
    </div>
  );
}
