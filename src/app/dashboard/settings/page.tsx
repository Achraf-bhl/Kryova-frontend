"use client";

import { useEffect, useState } from "react";

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted">Which model powers the assistant.</p>
      </div>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <h2 className="mb-3 text-sm font-semibold">Current provider</h2>
        {error && <p className="text-sm text-danger">{error}</p>}
        {!status && !error && <p className="text-sm text-muted">Checking…</p>}
        {status && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`h-2 w-2 rounded-full ${status.enabled ? "bg-success" : "bg-danger"}`}
                aria-hidden
              />
              <span className="text-sm font-medium">{status.provider}</span>
              <span className="rounded bg-canvas px-2 py-0.5 font-mono text-xs text-muted">
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
        <h2 className="text-sm font-semibold">Switching provider</h2>
        {/* Deliberately env-var based rather than a form: the setting belongs to
            the backend process, and a runtime override would need its own
            precedence rules and a place to store a key safely. */}
        <p className="text-sm text-muted">
          Set these in the backend&apos;s <code className="text-xs">.env</code>, then
          restart it.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          {PROVIDERS.map((provider) => (
            <div
              key={provider.id}
              className={`rounded-lg border p-3 ${
                status?.provider === provider.id
                  ? "border-primary bg-primary/5"
                  : "border-border bg-surface"
              }`}
            >
              <p className="text-sm font-medium">{provider.name}</p>
              <p className="mt-1 text-xs text-muted">{provider.blurb}</p>
              <pre className="mt-2 overflow-x-auto rounded bg-canvas p-2 text-[11px] leading-relaxed text-muted">
                {provider.env}
              </pre>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
