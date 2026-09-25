import { describe, expect, it } from "vitest";

import { buildCsp, isAuthRoute, isDynamicallyRendered, isProtectedRoute } from "./proxy";

function directive(csp: string, name: string): string | undefined {
  return csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
}

describe("route gate", () => {
  it("protects the dashboard and everything under it", () => {
    expect(isProtectedRoute("/dashboard")).toBe(true);
    expect(isProtectedRoute("/dashboard/projects/abc")).toBe(true);
    expect(isProtectedRoute("/dashboard/projects/abc/simulations/1")).toBe(true);
  });

  it("leaves the unauthenticated surface alone", () => {
    // The matcher now covers the whole site so every response gets a CSP, which
    // means the gate has to scope itself. /setup is the offline onboarding
    // wizard and /api/* answers with JSON — neither may be bounced to /login.
    expect(isProtectedRoute("/setup")).toBe(false);
    expect(isProtectedRoute("/login")).toBe(false);
    expect(isProtectedRoute("/register")).toBe(false);
    expect(isProtectedRoute("/api/catia/events")).toBe(false);
    expect(isProtectedRoute("/")).toBe(false);
  });

  it("does not treat a lookalike prefix as protected", () => {
    expect(isProtectedRoute("/dashboards")).toBe(false);
    expect(isProtectedRoute("/dashboard-public")).toBe(false);
  });

  it("recognises exactly the two auth routes", () => {
    expect(isAuthRoute("/login")).toBe(true);
    expect(isAuthRoute("/register")).toBe(true);
    expect(isAuthRoute("/login/reset")).toBe(false);
    expect(isAuthRoute("/dashboard")).toBe(false);
  });
});

describe("nonce scope", () => {
  it("nonces the dynamically rendered dashboard", () => {
    expect(isDynamicallyRendered("/dashboard")).toBe(true);
    expect(isDynamicallyRendered("/dashboard/settings")).toBe(true);
  });

  it("does not nonce statically prerendered routes", () => {
    // /login, /register and /setup are prerendered at build time (confirmed by
    // the build's route table). Next cannot stamp a nonce into a file written
    // before any request existed, and 'strict-dynamic' makes browsers ignore
    // 'self' — so a nonce here blocks the page's own bundle.
    expect(isDynamicallyRendered("/login")).toBe(false);
    expect(isDynamicallyRendered("/register")).toBe(false);
    expect(isDynamicallyRendered("/setup")).toBe(false);
    expect(isDynamicallyRendered("/")).toBe(false);
  });
});

describe("buildCsp", () => {
  const prod = { isDev: false, apiOrigin: "https://api.kryova.example" };

  it("uses the nonce and strict-dynamic when one is available", () => {
    const csp = buildCsp({ ...prod, nonce: "abc123" });
    expect(directive(csp, "script-src")).toBe(
      "script-src 'self' 'nonce-abc123' 'strict-dynamic'",
    );
  });

  it("never emits unsafe-inline scripts alongside a nonce", () => {
    // A nonce makes browsers ignore 'unsafe-inline' anyway; emitting both only
    // misleads whoever reads the header next.
    const csp = buildCsp({ ...prod, nonce: "abc123" });
    expect(directive(csp, "script-src")).not.toContain("'unsafe-inline'");
  });

  it("falls back to unsafe-inline scripts only where there is no nonce", () => {
    const csp = buildCsp({ ...prod, nonce: null });
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'unsafe-inline'");
  });

  it("never allows unsafe-eval in production", () => {
    expect(buildCsp({ ...prod, nonce: "abc" })).not.toContain("unsafe-eval");
    expect(buildCsp({ ...prod, nonce: null })).not.toContain("unsafe-eval");
  });

  it("allows unsafe-eval in development, where React needs it", () => {
    const csp = buildCsp({ nonce: "abc", isDev: true, apiOrigin: null });
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
  });

  it("derives connect-src from the API origin instead of hardcoding localhost", () => {
    expect(directive(buildCsp({ ...prod, nonce: null }), "connect-src")).toBe(
      "connect-src 'self' https://api.kryova.example",
    );
  });

  it("adds the dev websocket origins only in development", () => {
    const dev = buildCsp({ nonce: null, isDev: true, apiOrigin: "http://localhost:8000" });
    expect(directive(dev, "connect-src")).toContain("ws://localhost:*");
    expect(directive(buildCsp({ ...prod, nonce: null }), "connect-src")).not.toContain("ws://");
  });

  it("keeps unsafe-inline for styles, and only for styles", () => {
    // Documented trade-off: Next injects inline <style> for next/font and its
    // hoisted critical CSS, and does not nonce those on prerendered routes.
    const csp = buildCsp({ ...prod, nonce: "abc" });
    expect(directive(csp, "style-src")).toBe("style-src 'self' 'unsafe-inline'");
  });

  it("locks down the directives an XSS would otherwise reach for", () => {
    const csp = buildCsp({ ...prod, nonce: "abc" });
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
  });

  it("upgrades insecure requests only when the API is itself https", () => {
    expect(buildCsp({ ...prod, nonce: null })).toContain("upgrade-insecure-requests");
    // Upgrading against an http://localhost API would break every call in a
    // local production run.
    expect(
      buildCsp({ nonce: null, isDev: false, apiOrigin: "http://localhost:8000" }),
    ).not.toContain("upgrade-insecure-requests");
    expect(buildCsp({ nonce: null, isDev: true, apiOrigin: null })).not.toContain(
      "upgrade-insecure-requests",
    );
  });
});
