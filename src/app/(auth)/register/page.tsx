"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { safeRedirectPath } from "@/lib/safe-redirect";

/**
 * `useSearchParams` opts this into request-time rendering; the Suspense
 * boundary keeps the shell prerendered. Same pattern and same build-time reason
 * as the login page.
 */
export default function RegisterPage() {
  return (
    <Suspense fallback={<RegisterHeading />}>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterHeading() {
  return (
    <div>
      <h1 className="text-xl font-semibold">Create an account</h1>
      <p className="mt-1 text-sm text-muted">Upload CAD, define loads, and solve FEA.</p>
    </div>
  );
}

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // A brand-new account cannot have a second factor, so `register` never
      // returns a challenge here. The value is ignored rather than asserted:
      // pretending to handle a case that cannot happen is noise, and the type
      // already says it might.
      await register(email, password, fullName);
      // `?next=` was dead on this page until P2.6, which broke the invitation
      // flow specifically: "create an account with the address the invitation
      // was sent to" landed on the dashboard with the token discarded, and the
      // only symptom was a user insisting they had clicked the link.
      // `safeRedirectPath` is what stops the parameter becoming an open
      // redirect — the same guard the login page uses.
      router.push(safeRedirectPath(searchParams.get("next")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <RegisterHeading />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          id="fullName"
          label="Full name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          autoComplete="name"
        />
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
          minLength={8}
          autoComplete="new-password"
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" loading={loading}>
          Create account
        </Button>
      </form>
      <p className="text-sm text-muted">
        Already have an account?{" "}
        <Link
          href={`/login${searchParams.get("next") ? `?next=${encodeURIComponent(searchParams.get("next") ?? "")}` : ""}`}
          className="font-medium text-primary hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
