"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { safeRedirectPath } from "@/lib/safe-redirect";
import type { MfaChallenge } from "@/types/api";

/**
 * `useSearchParams` opts a component into request-time rendering, and this page
 * is otherwise prerendered. The Suspense boundary is what lets the shell stay
 * static while only the form waits for the query string — without it, `next
 * build` fails on this page rather than at runtime.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginHeading />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginHeading() {
  return (
    <div>
      <h1 className="font-display text-xl font-semibold">Sign in to Kryova</h1>
      <p className="mt-1 text-sm text-muted">Describe a part. Kryova builds and solves it.</p>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, completeMfa } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // A challenge in progress. Held on the form rather than in the auth context
  // because a half-finished login belongs to the page the user is looking at —
  // parking it globally would leave it alive across a navigation.
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);

  // `src/proxy.ts` stamps the page a signed-out visitor was trying to reach
  // onto this URL; pushing a hardcoded /dashboard threw that away and made
  // every deep link land on the home screen. `safeRedirectPath` is what stops
  // the same parameter becoming an open redirect.
  const goOnwards = () => router.push(safeRedirectPath(searchParams.get("next")));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const owed = await login(email, password);
      if (owed) {
        setChallenge(owed);
        return;
      }
      goOnwards();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  if (challenge) {
    return (
      <MfaStep
        challenge={challenge}
        onSubmit={async (code) => {
          await completeMfa(challenge.challenge_token, code);
          goOnwards();
        }}
        onCancel={() => {
          setChallenge(null);
          setPassword("");
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <LoginHeading />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="email"
        />
        <Input
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          autoComplete="current-password"
        />
        {error && (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2">
            <p className="text-sm text-danger">{error}</p>
            <p className="mt-1 text-xs text-muted">
              If this keeps happening, the{" "}
              <Link href="/setup" className="font-medium text-primary hover:underline">
                setup check
              </Link>{" "}
              will tell you whether the API, the database or the model provider is at fault.
            </p>
          </div>
        )}
        <Button type="submit" loading={loading}>
          Sign in
        </Button>
      </form>
      <p className="text-sm text-muted">
        No account?{" "}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}

/**
 * The second step of a sign-in (P1.7). A separate component rather than a
 * branch inside the form, so the password field is genuinely unmounted rather
 * than hidden — a browser autofilling a hidden password input on a code step is
 * how a password ends up submitted to the wrong endpoint.
 */
function MfaStep({
  challenge,
  onSubmit,
  onCancel,
}: {
  challenge: MfaChallenge;
  onSubmit: (code: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onSubmit(code.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code is not valid.");
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold">Enter your code</h1>
        <p className="mt-1 text-sm text-muted">
          Open your authenticator app and type the six-digit code for Kryova.
          {challenge.recovery_available && " A recovery code works here too."}
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          id="mfa-code"
          label="Six-digit code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
          // `one-time-code` is what lets a phone offer the code from the
          // notification; without it the field is just text and the user
          // retypes what they can see on another screen.
          autoComplete="one-time-code"
          inputMode="text"
          autoFocus
        />
        {error && (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2">
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}
        <Button type="submit" loading={loading}>
          Continue
        </Button>
      </form>
      <button
        type="button"
        onClick={onCancel}
        className="self-start text-sm text-muted hover:text-accent"
      >
        Use a different account
      </button>
    </div>
  );
}
