import type { NextConfig } from "next";

/**
 * Static response headers.
 *
 * The Content-Security-Policy deliberately does NOT live here: it needs a
 * per-request nonce and a `connect-src` derived from the deployment, so it is
 * built in `src/proxy.ts`. Two CSP headers would both be enforced and their
 * intersection is very easy to get wrong, so there is exactly one source.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  compress: true,
  poweredByHeader: false,
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
