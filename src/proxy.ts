import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts` (export `proxy` + `config`).
 * This file does two jobs: the cookie route gate, and the Content-Security-Policy.
 */

const AUTH_ROUTES = ["/login", "/register"];

/**
 * Prefixes the cookie gate applies to.
 *
 * The matcher below deliberately covers the whole site so every response gets a
 * CSP, which means the gate can no longer lean on the matcher to scope itself.
 * `/setup` (the offline onboarding wizard) and `/api/*` must stay reachable
 * without a session — bouncing an SSE consumer to an HTML login page would be a
 * confusing failure — so the gate names what it protects.
 */
const PROTECTED_PREFIXES = ["/dashboard"];

/** Routes that render dynamically on every request — see `isDynamicallyRendered`. */
const DYNAMIC_PREFIXES = ["/dashboard"];

const SESSION_COOKIES = ["kryova_access", "kryova_refresh"];

function underPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIES.some((name) => request.cookies.has(name));
}

export function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.includes(pathname);
}

/** Whether the path requires a session cookie to reach. */
export function isProtectedRoute(pathname: string): boolean {
  return underPrefix(pathname, PROTECTED_PREFIXES);
}

/**
 * Whether a nonce-based script policy is safe for this path.
 *
 * Next can only stamp a nonce into HTML it renders per request. A statically
 * prerendered page is written at build time, when no nonce exists, so serving
 * it under `script-src 'nonce-…' 'strict-dynamic'` blocks its own bundle and
 * leaves a blank page — `'strict-dynamic'` makes browsers ignore `'self'`.
 *
 * Everything under `/dashboard` is `export const dynamic = "force-dynamic"`
 * (see `app/dashboard/layout.tsx`), which is the whole authenticated surface
 * and therefore everything worth protecting with a strict policy. `/login`,
 * `/register` and `/setup` are client components with no such opt-in, so they
 * prerender and get the relaxed policy below. If those pages ever opt into
 * dynamic rendering, add their prefixes here and the strict policy follows.
 */
export function isDynamicallyRendered(pathname: string): boolean {
  return underPrefix(pathname, DYNAMIC_PREFIXES);
}

/**
 * Origin of the backend, so `connect-src` follows the deployment.
 *
 * The fallback must stay identical to `lib/api-client.ts`'s: if the client
 * defaults to `http://localhost:8000` and the policy does not, every API call
 * is blocked with nothing in any server log to explain it.
 */
const DEFAULT_API_URL = "http://localhost:8000/api/v1";

function apiOrigin(): string | null {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL).origin;
  } catch {
    return null;
  }
}

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Build the policy for one request.
 *
 * `connect-src` is derived from `NEXT_PUBLIC_API_URL` rather than hardcoded:
 * a hardcoded `http://localhost:8000` blocks every API call the moment the app
 * is deployed anywhere real, and the failure shows up only as a console
 * violation with no server-side log line at all.
 *
 * `style-src` keeps `'unsafe-inline'`. Next injects inline `<style>` for
 * `next/font` and for the critical CSS it hoists, and Tailwind v4's build emits
 * a plain stylesheet — nothing here needs inline *scripts*, but stripping
 * inline styles would need every one of those injection points nonced, which
 * Next does not do for statically prerendered routes. Scripts are the injection
 * vector that matters, and they are nonce-gated wherever that is possible.
 */
export function buildCsp(options: {
  nonce: string | null;
  isDev: boolean;
  apiOrigin: string | null;
}): string {
  const { nonce, isDev, apiOrigin: origin } = options;

  const connectSrc = ["'self'", ...(origin ? [origin] : [])];
  if (isDev) {
    // Dev-server HMR socket. Not emitted in production builds.
    connectSrc.push("ws://localhost:*", "ws://127.0.0.1:*");
  }

  const scriptSrc = nonce
    ? ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]
    : ["'self'", "'unsafe-inline'"];
  // React uses `eval` in development to rebuild server stacks in the browser.
  // Production React and Next do not, so this is never emitted in a real build.
  if (isDev) scriptSrc.push("'unsafe-eval'");

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src ${connectSrc.join(" ")}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  // Only safe once the backend is itself https; upgrading requests to an
  // http://localhost API would break every call in a local production run.
  if (!isDev && (origin === null || origin.startsWith("https://"))) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isDev = process.env.NODE_ENV === "development";
  const nonce = isDynamicallyRendered(pathname) ? createNonce() : null;
  const csp = buildCsp({ nonce, isDev, apiOrigin: apiOrigin() });

  const applyCsp = (response: NextResponse): NextResponse => {
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };

  const signedIn = hasSessionCookie(request);

  if (!signedIn && isProtectedRoute(pathname)) {
    const loginUrl = new URL("/login", request.url);
    // Preserve the deep link so signing in lands where the user was headed.
    // Path plus query only — never an absolute URL, which would make this an
    // open redirect. `lib/safe-redirect.ts` re-validates on the way out.
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return applyCsp(NextResponse.redirect(loginUrl));
  }

  // A signed-in visitor has no use for the sign-in pages; sending them to
  // /login would also strand them there, since the form would just bounce back.
  if (signedIn && isAuthRoute(pathname)) {
    return applyCsp(NextResponse.redirect(new URL("/dashboard", request.url)));
  }

  return applyCsp(passThrough(request, nonce, csp));
}

/**
 * Continue to the route, forwarding the nonce so Next can stamp it onto the
 * scripts it renders (it reads it back off the request's CSP header).
 */
function passThrough(request: NextRequest, nonce: string | null, csp: string): NextResponse {
  if (!nonce) return NextResponse.next();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Every route needs the CSP, not just the gated ones, so the matcher is a
  // negative match on build output rather than the old explicit page list.
  // The gate itself stays path-scoped inside `proxy` above.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
