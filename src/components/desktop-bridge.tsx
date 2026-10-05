"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useCatiaStatus } from "@/hooks/use-catia-status";
import {
  checkForUpdate,
  collectDeepLinks,
  reportTrayStatus,
  resolveLinks,
  subscribeToDeepLinks,
  tauriGlobal,
  trayText,
  type PendingUpdate,
} from "@/lib/desktop-bridge";

/**
 * Wires the desktop shell to the page (ROAD_TO_10 4.7). Renders nothing in a browser.
 *
 * Three jobs. **Updates** (4.6): ask once, at launch, whether a newer signed release exists
 * and offer it -- never install without a click, because an installer that ends the process
 * mid-simulation is the app deciding what a person's afternoon was for. **Deep links**: the shell holds `kryova://` links it was handed and says when
 * there are some; this collects them, judges each with `desktop-powers.ts`'s allow-list
 * (read-only targets only) and navigates to the newest valid one. A link it refuses is shown,
 * not swallowed -- a click that does nothing reads as a broken app. **The tray**: the shell
 * does not hold a session and so cannot ask the API anything; this tells it whether the
 * CATIA bridge is connected and it shows that.
 *
 * What is *not* here, said so the next person does not look for it: the tray carries no
 * count of running jobs and nothing notifies when a run finishes while the person is
 * elsewhere. Both need a list of the signed-in user's active runs across projects, and the
 * API only lists them per project (master plan 7.9).
 */
const never = () => () => {};

export function DesktopBridge() {
  // Whether this is the desktop shell is a fact about the window, not React state. Read
  // through `useSyncExternalStore` so the server render (no `window.__TAURI__`) and the
  // first client render agree -- a page that renders differently on the two sides fails to
  // hydrate -- and it flips to true once, after hydration, with no effect to do it.
  const desktop = useSyncExternalStore(
    never,
    () => tauriGlobal() !== null,
    () => false,
  );
  if (!desktop) return null;
  return (
    <>
      <Updates />
      <DeepLinks />
      <Tray />
    </>
  );
}

function DeepLinks() {
  const router = useRouter();
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    const drain = () => {
      void collectDeepLinks().then((waiting) => {
        if (cancelled || waiting.length === 0) return;
        const { route, refusals } = resolveLinks(waiting);
        if (refusals.length > 0) setRefusal(refusals.join(" "));
        if (route) router.push(route);
      });
    };
    drain();
    void subscribeToDeepLinks(drain).then((unlisten) => {
      if (cancelled) unlisten();
      else stop = unlisten;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [router]);

  if (!refusal) return null;
  return (
    <div
      role="status"
      className="mx-4 mt-3 flex items-start justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-sm"
    >
      <span>{refusal}</span>
      <button type="button" onClick={() => setRefusal(null)} className="shrink-0 underline">
        Dismiss
      </button>
    </div>
  );
}

function Tray() {
  const { state } = useCatiaStatus();
  useEffect(() => {
    void reportTrayStatus(trayText(state));
  }, [state]);
  return null;
}

function Updates() {
  const [update, setUpdate] = useState<PendingUpdate | null>(null);
  const [state, setState] = useState<"offered" | "installing" | "dismissed">("offered");
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Once per launch. The layout this lives in does not remount between pages.
    void checkForUpdate().then((found) => {
      if (!cancelled && found) setUpdate(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update || state === "dismissed") return null;

  const install = () => {
    setState("installing");
    setFailure(null);
    void update.install().then((reason) => {
      // Success normally ends this process before anything arrives here.
      if (reason) {
        setFailure(reason);
        setState("offered");
      }
    });
  };

  return (
    <div
      role="status"
      className="mx-4 mt-3 flex items-start justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-sm"
    >
      <span>
        {failure ??
          (state === "installing"
            ? `Installing Kryova ${update.version}. The app will restart.`
            : `Kryova ${update.version} is available.`)}
      </span>
      <span className="flex shrink-0 gap-3">
        {state === "offered" ? (
          <button type="button" onClick={install} className="underline">
            Install and restart
          </button>
        ) : null}
        {state === "offered" ? (
          <button type="button" onClick={() => setState("dismissed")} className="underline">
            Later
          </button>
        ) : null}
      </span>
    </div>
  );
}
