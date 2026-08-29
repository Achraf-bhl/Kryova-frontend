"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CatiaDeviceManager } from "@/components/catia/device-manager";
import { PageShell } from "@/components/ui/page-shell";
import { api } from "@/lib/api-client";
import type { AIStatus } from "@/types/api";

const PROVIDERS = [
  {
    id: "ollama",
    name: "Ollama (local)",
    blurb: "Runs on this machine. No API key, works offline, nothing leaves your computer.",
    env: "AI_PROVIDER=ollama\nAI_MODEL=qwen2.5-coder:7b",
  },
  {
    id: "openai_compatible",
    name: "OpenAI-compatible",
    blurb: "LM Studio, vLLM, llama.cpp, Groq, OpenRouter, OpenAI — anything on /v1.",
    env: "AI_PROVIDER=openai_compatible\nAI_BASE_URL=http://localhost:1234/v1\nAI_MODEL=your-model",
  },
  {
    id: "anthropic",
    name: "Anthropic (hosted)",
    blurb: "Hosted Claude. Needs an API key, and your geometry summary leaves the machine.",
    env: "AI_PROVIDER=anthropic\nAI_API_KEY=sk-ant-...\nAI_MODEL=claude-opus-5",
  },
];

export default function SettingsPage() {
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .aiStatus()
      .then(setStatus)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <PageShell className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted">
          The model behind the agent, and the workstation it drives CATIA on.
        </p>
      </div>

      {/* The anchor the composer's CATIA chip and the bridge panel link to. */}
      <section id="catia" className="scroll-mt-6 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-accent">CATIA workstations</h2>
          <p className="mt-1 max-w-prose text-sm text-muted">
            The bridge runs on the Windows machine with CATIA and connects out to Kryova, so
            there is no port to open and nothing to expose. Each chat then owns one CATIA
            document.
          </p>
        </div>
        <CatiaDeviceManager />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-accent">Current model provider</h2>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {!status && !error && <p className="text-sm text-muted">Checking…</p>}
        {status && (
          <div className="k-panel space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`h-2 w-2 rounded-full ${status.enabled ? "bg-live" : "bg-danger"}`}
                aria-hidden="true"
              />
              <span className="text-sm font-medium">{status.provider}</span>
              <span className="rounded-sm bg-surface-sunken px-2 py-0.5 font-mono text-xs text-muted">
                {status.model}
              </span>
              <span className="text-xs text-muted">
                {status.enabled ? "ready" : "unavailable"}
              </span>
            </div>
            {status.detail && (
              <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
                {status.detail}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-accent">Switching provider</h2>
        {/* Deliberately env-var based rather than a form: the setting belongs to
            the backend process, and a runtime override would need its own
            precedence rules and a place to store a key safely. */}
        <p className="text-sm text-muted">
          Set these in the backend&apos;s <code className="font-mono text-xs">.env</code>, then
          restart it.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          {PROVIDERS.map((provider) => (
            <div
              key={provider.id}
              className={`rounded-md border p-3 ${
                status?.provider === provider.id
                  ? "border-primary bg-primary-soft"
                  : "border-border bg-surface"
              }`}
            >
              <p className="text-sm font-medium">{provider.name}</p>
              <p className="mt-1 text-xs text-muted">{provider.blurb}</p>
              <pre className="k-scroll mt-2 overflow-x-auto rounded-sm bg-surface-sunken p-2 font-mono text-[0.6875rem] leading-relaxed text-muted">
                {provider.env}
              </pre>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-accent">Something not working?</h2>
        <p className="text-sm text-muted">
          The setup wizard checks the API, the database, the solver and the model provider one
          by one and tells you which is at fault.
        </p>
        <Link
          href="/setup"
          className="inline-block rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-accent hover:border-border-strong"
        >
          Open the setup check
        </Link>
      </section>
    </PageShell>
  );
}
