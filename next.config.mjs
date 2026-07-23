/** @type {import('next').NextConfig} */

// Security response headers, applied to every route (belt-and-braces on top of
// Traefik's admin-path blocking on guest hosts). The CSP is NOT here: it is
// per-request (nonce-based script-src) and lives in src/proxy.ts — a second
// static copy would intersect with it and break the nonce.
const securityHeaders = [
  // 180 days; no includeSubDomains/preload so it can't strand a non-HTTPS
  // subdomain. Honoured by browsers only over the HTTPS Traefik edge.
  { key: "Strict-Transport-Security", value: "max-age=15552000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" }, // legacy backstop for frame-ancestors
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig = {
  reactStrictMode: true,
  // Trace-and-copy build: .next/standalone ships server.js + only the
  // node_modules subset the app actually imports, instead of the full
  // ~970 MB tree — the Dockerfile runner stage copies that (image was
  // 1.55 GB before this).
  output: "standalone",
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default nextConfig;
