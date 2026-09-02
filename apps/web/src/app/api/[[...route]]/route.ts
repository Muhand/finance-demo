/**
 * The API is the same Hono app that runs standalone on :4000 — mounted here as
 * a Next route handler so the whole system deploys as one Vercel project with
 * no CORS and no cross-service origin to configure.
 *
 * `createApp()` builds its own deps from the environment, so the provider
 * factories (Anthropic / Pinecone / embedder) behave exactly as they do locally.
 */
import { handle } from "hono/vercel";
import { createApp } from "@finance-demo/api/server.ts";

// Node, not edge: the graph uses node:fs for the research cache and the SEC
// toolkit expects a full Node runtime.
export const runtime = "nodejs";
// The cold path runs SEC fetch + embed + question-gen + N sub-agents + synthesis.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const app = createApp();

export const GET = handle(app);
export const POST = handle(app);
export const OPTIONS = handle(app);
