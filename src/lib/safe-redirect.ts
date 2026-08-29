/** Where a signed-in user lands when there is no usable `?next=` target. */
export const DEFAULT_REDIRECT = "/dashboard";

/**
 * Validate a `?next=` deep-link target before navigating to it.
 *
 * `src/proxy.ts` stamps the path a signed-out visitor was trying to reach onto
 * the login URL. Sending the browser to whatever comes back in that query
 * parameter is an open redirect: an attacker links to
 * `/login?next=https://evil.example` (or the sneakier protocol-relative
 * `//evil.example`, which browsers resolve as an absolute URL), the victim signs
 * in for real, and lands on a phishing page wearing our referrer.
 *
 * Only a single-slash-prefixed, same-origin path survives. Anything else falls
 * back to {@link DEFAULT_REDIRECT}, so callers can use the result
 * unconditionally rather than branching on null.
 */
export function safeRedirectPath(
  target: string | null | undefined,
  fallback: string = DEFAULT_REDIRECT,
): string {
  if (typeof target !== "string") return fallback;

  const trimmed = target.trim();
  if (trimmed === "") return fallback;

  // Must be a rooted path. Rejects "dashboard", "https://evil.example",
  // "javascript:alert(1)" and every other scheme-bearing form.
  if (!trimmed.startsWith("/")) return fallback;

  // Protocol-relative ("//evil.example") and the backslash variants browsers
  // normalise to it ("/\evil.example").
  if (trimmed.length > 1 && (trimmed[1] === "/" || trimmed[1] === "\\")) return fallback;

  // A control character or raw newline can split the URL once it is written
  // into a Location header. Nothing legitimate contains one. Checked by code
  // point rather than by regex so the pattern stays readable and there is no
  // `no-control-regex` suppression to misread later.
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return fallback;
  }

  // Bouncing back to the auth pages would loop: the proxy redirects a signed-in
  // visitor off /login straight back to the dashboard.
  const pathOnly = trimmed.split(/[?#]/)[0];
  if (pathOnly === "/login" || pathOnly === "/register") return fallback;

  return trimmed;
}
