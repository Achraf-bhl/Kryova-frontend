"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { safeRedirectPath } from "@/lib/safe-redirect";

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
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      // `src/proxy.ts` stamps the page a signed-out visitor was trying to reach
      // onto this URL; pushing a hardcoded /dashboard threw that away and made
      // every deep link land on the home screen. `safeRedirectPath` is what
      // stops the same parameter becoming an open redirect.
      router.push(safeRedirectPath(searchParams.get("next")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
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
