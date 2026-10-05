import { describe, expect, it, vi } from "vitest";

import {
  DEEP_LINK_EVENT,
  checkForUpdate,
  collectDeepLinks,
  reportTrayStatus,
  resolveLinks,
  sendNotice,
  subscribeToDeepLinks,
  tauriGlobal,
  trayText,
  type TauriGlobal,
} from "./desktop-bridge";

/**
 * The page's calls into the desktop shell (ROAD_TO_10 4.7). The decisions -- which link may
 * open, whether a run earns a notification -- are `desktop-powers.test.ts`'s; these are the
 * calls around them, driven against a recording fake of `window.__TAURI__` because no shell
 * is available to a unit test. What a fake cannot show -- that Tauri really grants this page
 * IPC -- is THE QUEUE G5.
 */

function shell(overrides: Partial<TauriGlobal> = {}): TauriGlobal {
  return { core: { invoke: vi.fn(async () => undefined) }, ...overrides };
}

describe("finding the shell", () => {
  it("is null in a browser, and the object when the shell has put it there", () => {
    expect(tauriGlobal({})).toBeNull();
    expect(tauriGlobal({ __TAURI__: null })).toBeNull();
    expect(tauriGlobal({ __TAURI__: "yes" })).toBeNull();
    const fake = shell();
    expect(tauriGlobal({ __TAURI__: fake })).toBe(fake);
  });

  it("makes every call a quiet no-op without it", async () => {
    await expect(collectDeepLinks(null)).resolves.toEqual([]);
    await expect(reportTrayStatus("x", null)).resolves.toBeUndefined();
    await expect(sendNotice({ title: "t", body: "b" }, null)).resolves.toBe(false);
    const stop = await subscribeToDeepLinks(() => {}, null);
    expect(stop).toBeTypeOf("function");
    expect(() => stop()).not.toThrow();
  });
});

describe("collecting links", () => {
  it("asks the shell for what it holds and returns strings only", async () => {
    const invoke = vi.fn(async () => ["kryova://run/abc", 42, null, "kryova://project/p1"]);

    const links = await collectDeepLinks(shell({ core: { invoke } }));

    expect(invoke).toHaveBeenCalledWith("take_deep_links", undefined);
    expect(links).toEqual(["kryova://run/abc", "kryova://project/p1"]);
  });

  it("returns nothing when the shell answers with something that is not a list", async () => {
    const invoke = vi.fn(async () => "kryova://run/abc");

    await expect(collectDeepLinks(shell({ core: { invoke } }))).resolves.toEqual([]);
  });

  it("returns nothing, and does not throw, when the command is refused", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("command take_deep_links not allowed");
    });

    await expect(collectDeepLinks(shell({ core: { invoke } }))).resolves.toEqual([]);
  });
});

describe("the nudge", () => {
  it("listens for the one event the shell emits and stops when told", async () => {
    const unlisten = vi.fn();
    let handler: ((event: unknown) => void) | undefined;
    const listen = vi.fn(async (_event: string, next: (event: unknown) => void) => {
      handler = next;
      return unlisten;
    });
    const nudged = vi.fn();

    const stop = await subscribeToDeepLinks(nudged, shell({ event: { listen } }));
    handler?.({ payload: null });
    stop();

    expect(listen).toHaveBeenCalledWith(DEEP_LINK_EVENT, expect.any(Function));
    expect(DEEP_LINK_EVENT).toBe("kryova:deep-link");
    expect(nudged).toHaveBeenCalledTimes(1);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("gives back a harmless stop when listening fails", async () => {
    const listen = vi.fn(async () => {
      throw new Error("event.listen not allowed");
    });

    const stop = await subscribeToDeepLinks(() => {}, shell({ event: { listen } }));

    expect(() => stop()).not.toThrow();
  });
});

describe("judging links", () => {
  it("goes to the newest valid link and says why it refused the rest", () => {
    const outcome = resolveLinks([
      "kryova://run/abc",
      "https://evil.example/run/abc",
      "kryova://delete/abc",
      "kryova://project/p1",
    ]);

    expect(outcome.route).toBe("/dashboard/projects/p1");
    expect(outcome.refusals).toHaveLength(2);
    expect(outcome.refusals.join(" ")).toMatch(/only opens kryova:\/\//);
    expect(outcome.refusals.join(" ")).toMatch(/run, conversation, project/);
  });

  it("navigates nowhere when nothing was valid", () => {
    expect(resolveLinks(["kryova://run/abc/cancel"])).toMatchObject({ route: null });
    expect(resolveLinks([])).toEqual({ route: null, refusals: [] });
  });

  it("refuses what is not a single id under a read-only target", () => {
    for (const link of [
      "kryova://run/abc/cancel",
      "kryova://approve/abc",
      "kryova://delete/abc",
      "kryova://run/a b",
      "kryova://run/..%2f..%2fadmin",
      "kryova://run",
      "javascript:alert(1)",
      "kryova:run/abc",
    ]) {
      expect(resolveLinks([link]).route, link).toBeNull();
    }
  });

  it("can only ever produce a read-only route inside the app, whatever the link tries", () => {
    // The URL parser itself resolves `..` and drops the query, so these are *accepted* -- as
    // an ordinary id, and with the query gone. What must hold is the shape of the result:
    // a fixed template with one `[A-Za-z0-9_-]` id substituted, so nothing a link says can
    // reach another path, another origin or an action.
    const route = /^\/dashboard\/(simulations|conversations|projects)\/[A-Za-z0-9_-]+$/;
    for (const link of [
      "kryova://run/abc",
      "kryova://conversation/c-1",
      "kryova://project/P_2",
      "kryova://run/abc?next=https://evil.example",
      "kryova://run/abc#//evil.example",
      "kryova://run/../admin",
    ]) {
      const { route: resolved } = resolveLinks([link]);
      expect(resolved, link).toMatch(route);
      expect(resolved, link).not.toContain("evil");
    }
  });
});

describe("the tray", () => {
  it("says what the bridge is doing, in words, and plain `Kryova` before it knows", () => {
    expect(trayText("connected")).toBe("Kryova — CATIA connected");
    expect(trayText("offline")).toBe("Kryova — CATIA not connected");
    expect(trayText("unavailable")).toBe("Kryova — CATIA unavailable");
    expect(trayText("connecting")).toBe("Kryova");
  });

  it("hands the shell the text under the name its command expects", async () => {
    const invoke = vi.fn(async () => undefined);

    await reportTrayStatus("Kryova — CATIA connected", shell({ core: { invoke } }));

    expect(invoke).toHaveBeenCalledWith("set_tray_status", { text: "Kryova — CATIA connected" });
  });
});

describe("notifications", () => {
  const notice = { title: "Simulation finished", body: "bracket finished in 4 min." };

  function notifier(granted: boolean, asks: string = "granted") {
    const sendNotification = vi.fn();
    const requestPermission = vi.fn(async () => asks);
    const isPermissionGranted = vi.fn(async () => granted);
    return {
      sendNotification,
      requestPermission,
      tauri: shell({ notification: { isPermissionGranted, requestPermission, sendNotification } }),
    };
  }

  it("sends straight away when permission is already granted", async () => {
    const { tauri, sendNotification, requestPermission } = notifier(true);

    await expect(sendNotice(notice, tauri)).resolves.toBe(true);

    expect(sendNotification).toHaveBeenCalledWith(notice);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("asks once when it has not been granted, and sends if the answer is yes", async () => {
    const { tauri, sendNotification, requestPermission } = notifier(false, "granted");

    await expect(sendNotice(notice, tauri)).resolves.toBe(true);

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the person said no", async () => {
    const { tauri, sendNotification } = notifier(false, "denied");

    await expect(sendNotice(notice, tauri)).resolves.toBe(false);

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("does not throw when the plugin does", async () => {
    const tauri = shell({
      notification: {
        isPermissionGranted: async () => {
          throw new Error("notification plugin not initialised");
        },
        sendNotification: vi.fn(),
      },
    });

    await expect(sendNotice(notice, tauri)).resolves.toBe(false);
  });
});

describe("updates", () => {
  const release = (overrides: Record<string, unknown> = {}) => ({
    version: "0.3.0",
    downloadAndInstall: vi.fn(async () => undefined),
    ...overrides,
  });

  it("reports a newer release, and installs nothing until asked", async () => {
    const update = release();
    const found = await checkForUpdate(shell({ updater: { check: vi.fn(async () => update) } }));

    expect(found?.version).toBe("0.3.0");
    expect(update.downloadAndInstall).not.toHaveBeenCalled();

    expect(await found?.install()).toBeNull();
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
  });

  it("is null in a browser, in a build with no updater, and when this is the newest", async () => {
    expect(await checkForUpdate(null)).toBeNull();
    expect(await checkForUpdate(shell())).toBeNull();
    expect(await checkForUpdate(shell({ updater: { check: vi.fn(async () => null) } }))).toBeNull();
  });

  it("is null, never an error, when the endpoint cannot be reached", async () => {
    const offline = vi.fn(async () => {
      throw new Error("Could not fetch a valid release JSON from the remote");
    });
    expect(await checkForUpdate(shell({ updater: { check: offline } }))).toBeNull();
  });

  it("refuses a version that is not shaped like one, because a person will read it", async () => {
    for (const version of ["<script>", "0.3", "v0.3.0", "0.3.0 now", "", 3, null]) {
      const check = vi.fn(async () => release({ version }));
      expect(await checkForUpdate(shell({ updater: { check } })), String(version)).toBeNull();
    }
    const pre = await checkForUpdate(
      shell({ updater: { check: vi.fn(async () => release({ version: "0.3.0-beta.1" })) } }),
    );
    expect(pre?.version).toBe("0.3.0-beta.1");
  });

  it("is null when the release cannot be installed, rather than offering a button that cannot work", async () => {
    const check = vi.fn(async () => ({ version: "0.3.0" }));
    expect(await checkForUpdate(shell({ updater: { check } }))).toBeNull();
  });

  it("says in words that the current version keeps working when an install fails", async () => {
    const failing = release({
      downloadAndInstall: vi.fn(async () => {
        throw new Error("signature verification failed");
      }),
    });
    const found = await checkForUpdate(shell({ updater: { check: vi.fn(async () => failing) } }));

    const message = await found?.install();
    expect(message).toMatch(/could not be installed/);
    expect(message).toMatch(/signature verification failed/);
    expect(message).toMatch(/keeps working/);
  });
});
