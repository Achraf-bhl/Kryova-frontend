import { describe, expect, it } from "vitest";

import { DEFAULT_REDIRECT, safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it("accepts a plain same-origin path", () => {
    expect(safeRedirectPath("/dashboard/projects/abc")).toBe("/dashboard/projects/abc");
  });

  it("keeps a query string and fragment", () => {
    expect(safeRedirectPath("/dashboard?page=2#results")).toBe("/dashboard?page=2#results");
  });

  it("falls back when there is no target", () => {
    expect(safeRedirectPath(null)).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("   ")).toBe(DEFAULT_REDIRECT);
  });

  it("honours a caller-supplied fallback", () => {
    expect(safeRedirectPath(null, "/setup")).toBe("/setup");
  });

  it("rejects absolute URLs", () => {
    expect(safeRedirectPath("https://evil.example/steal")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("http://evil.example")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects protocol-relative URLs", () => {
    // The classic open-redirect payload: browsers resolve "//host" against the
    // current scheme, so it is an absolute URL that merely looks like a path.
    expect(safeRedirectPath("//evil.example")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("//evil.example/dashboard")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects the backslash variants browsers normalise to protocol-relative", () => {
    expect(safeRedirectPath("/\\evil.example")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("\\\\evil.example")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects scheme-bearing targets", () => {
    expect(safeRedirectPath("javascript:alert(1)")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("data:text/html,<script>")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects a relative path with no leading slash", () => {
    expect(safeRedirectPath("dashboard")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("../etc/passwd")).toBe(DEFAULT_REDIRECT);
  });

  it("rejects control characters that could split a Location header", () => {
    expect(safeRedirectPath("/dashboard\nLocation: https://evil.example")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("/dashboard\r\nSet-Cookie: a=b")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("/dashboard\tmore")).toBe(DEFAULT_REDIRECT);
  });

  it("refuses to bounce back to the auth pages", () => {
    // Would loop: the proxy sends a signed-in visitor off /login again.
    expect(safeRedirectPath("/login")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("/register")).toBe(DEFAULT_REDIRECT);
    expect(safeRedirectPath("/login?next=/dashboard")).toBe(DEFAULT_REDIRECT);
  });

  it("does not mistake a longer path for an auth route", () => {
    expect(safeRedirectPath("/login-help")).toBe("/login-help");
  });

  it("trims surrounding whitespace before deciding", () => {
    expect(safeRedirectPath("  /dashboard  ")).toBe("/dashboard");
    expect(safeRedirectPath("  //evil.example  ")).toBe(DEFAULT_REDIRECT);
  });
});
