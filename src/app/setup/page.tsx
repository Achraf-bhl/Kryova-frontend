"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { detectPlatform, runHealthChecks, type HealthCheckResult, type Platform } from "@/lib/system";

const PLATFORM_LABELS: Record<Platform, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
  unknown: "Unknown platform",
};

export default function SetupPage() {
  const [platform, setPlatform] = useState<Platform>("unknown");
  const [checks, setChecks] = useState<HealthCheckResult[] | null>(null);
  const [running, setRunning] = useState(true);

  const runChecks = useCallback(() => {
    setRunning(true);
    setChecks(null);
    void runHealthChecks().then((results) => {
      setChecks(results);
      setRunning(false);
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPlatform(detectPlatform());
      runChecks();
    }, 50);
    return () => clearTimeout(timer);
  }, [runChecks]);

  const allOk = checks !== null && checks.every((c) => c.ok);
  const apiResult = checks?.find((c) => c.prerequisite.id === "api");
  const webglResult = checks?.find((c) => c.prerequisite.id === "browser");

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg rounded-lg bg-surface p-8 shadow-card">
        <h1 className="text-xl font-semibold">Welcome to Kryova</h1>
        <p className="mt-1 text-sm text-muted">
          Let&apos;s verify your system is ready before you start.
        </p>

        <div className="mt-4 flex items-center gap-2 rounded-md bg-canvas px-3 py-2 text-sm">
          <span className="font-medium">{PLATFORM_LABELS[platform]}</span>
          <span className="text-muted">detected</span>
        </div>

        {running ? (
          <div className="mt-6 flex flex-col gap-3">
            {["Modern browser", "Kryova API server"].map((label) => (
              <div key={label} className="flex items-center justify-between px-1 py-2 text-sm">
                <span>{label}</span>
                <span className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ))}
          </div>
        ) : checks ? (
          <ul className="mt-6 flex flex-col divide-y divide-border">
            {checks.map(({ prerequisite, ok, error }) => (
              <li key={prerequisite.id} className="flex items-start justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium">{prerequisite.label}</p>
                  <p className="mt-0.5 text-xs text-muted">{prerequisite.description}</p>
                  {!ok && (
                    <p className="mt-1.5 text-xs text-danger">
                      {error ?? prerequisite.installHint}{" "}
                      <a
                        href={prerequisite.installUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        Learn more
                      </a>
                    </p>
                  )}
                </div>
                {ok ? (
                  <span className="mt-0.5 size-5 shrink-0 rounded-full bg-success/15 p-1 text-success">
                    ✓
                  </span>
                ) : (
                  <span className="mt-0.5 size-5 shrink-0 rounded-full bg-danger/15 p-1 text-danger font-bold text-xs flex items-center justify-center">
                    ✕
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {!running && checks && (
          <div className="mt-8 flex flex-col gap-3">
            {allOk ? (
              <>
                <Link href="/register" className="w-full">
                  <Button className="w-full">Get started — create an account</Button>
                </Link>
                <Link href="/login" className="w-full">
                  <Button variant="secondary" className="w-full">I already have an account</Button>
                </Link>
              </>
            ) : (
              <>
                {!allOk && !webglResult?.ok && (
                  <div className="rounded-md bg-red-50 p-4 text-sm text-danger">
                    WebGL is required for the 3D stress viewer. Enable hardware acceleration or try a different browser.
                  </div>
                )}
                {!allOk && !apiResult?.ok && (
                  <div className="rounded-md bg-amber-50 p-4 text-sm text-amber-700">
                    The API server is not reachable. Start it with{" "}
                    <code className="rounded bg-white/50 px-1 py-0.5 font-mono text-xs">uvicorn app.main:app --reload</code>{" "}
                    then retry.
                  </div>
                )}
                <Button variant="secondary" onClick={runChecks} className="w-full">
                  Retry checks
                  </Button>
                <Link href="/login" className="text-center text-sm text-muted hover:text-accent">
                  Continue anyway (some features may not work)
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
