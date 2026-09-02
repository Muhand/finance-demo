import type { NextConfig } from "next";

/**
 * The browser always talks to same-origin `/api/*`; Next rewrites those
 * requests to the API service. Override the target with `API_ORIGIN`.
 */
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The contracts package ships raw TypeScript from its workspace source.
  transpilePackages: ["@finance-demo/contracts"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_ORIGIN}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
