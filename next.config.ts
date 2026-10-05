import { execSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Static response headers.
 *
 * The Content-Security-Policy deliberately does NOT live here: it needs a
 * per-request nonce and a `connect-src` derived from the deployment, so it is
 * built in `src/proxy.ts`. Two CSP headers would both be enforced and their
 * intersection is very easy to get wrong, so there is exactly one source.
 */

function resolveBuildSha(): string {
  if (process.env.NEXT_PUBLIC_BUILD_SHA) {
    return process.env.NEXT_PUBLIC_BUILD_SHA;
  }
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

process.env.NEXT_PUBLIC_BUILD_SHA = resolveBuildSha();
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/**
 * The installer ships the app as Next's standalone server (ROAD_TO_10 4.1).
 *
 * **Opt-in, and only the desktop build opts in.** `output: "standalone"` changes what
 * `next build` writes and makes `next start` print a warning, and the web deployment and
 * every developer's `npm run build && npm start` are the ones that must not notice. The
 * staging script (`scripts/stage-desktop.mjs`) sets this variable for its own build and
 * nothing else does.
 *
 * `outputFileTracingRoot` pins the trace to this checkout. Left to guess, Next walks up to
 * the nearest lockfile, and a sibling checkout or a lockfile in a home directory moves the
 * root -- the standalone output then nests the app under a directory named after the
 * checkout and `server.js` is not where the shell looks for it.
 */
const standalone = process.env.KRYOVA_STANDALONE === "1";

const nextConfig: NextConfig = {
  ...(standalone
    ? {
        output: "standalone" as const,
        outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
      }
    : {}),
  reactStrictMode: true,
  compress: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_BUILD_SHA: process.env.NEXT_PUBLIC_BUILD_SHA,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
