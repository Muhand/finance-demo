import type { NextConfig } from "next";

/**
 * The API ships as a Next route handler (`src/app/api/[[...route]]`), so the
 * browser and the API are same-origin and nothing needs configuring.
 *
 * Set `API_ORIGIN` only to point at a separately-running API service (e.g. the
 * standalone Hono server on :4000 during backend work); when it is unset, the
 * in-process route handler serves `/api/*`.
 */
const API_ORIGIN = process.env.API_ORIGIN;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Both workspace packages ship raw TypeScript from source.
  transpilePackages: ["@finance-demo/contracts", "@finance-demo/api"],
  // Native/heavy deps must stay outside the bundle and be required at runtime.
  serverExternalPackages: [
    "@huggingface/transformers",
    "onnxruntime-node",
    "sharp",
    "sec-edgar-toolkit",
    "yahoo-finance2",
    "@pinecone-database/pinecone",
  ],
  ...(API_ORIGIN
    ? {
        async rewrites() {
          return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
        },
      }
    : {}),
};

export default nextConfig;
