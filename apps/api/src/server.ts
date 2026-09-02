import { Hono } from "hono";
import { cors } from "hono/cors";

import { AskRequestSchema, ROUTES, type ApiError } from "@finance-demo/contracts";

import { ResearchCache } from "./cache.ts";
import { createEmbedder } from "./embeddings.ts";
import { AskError, runAsk, type Deps, type ErrorCode } from "./graph.ts";
import { createLlm } from "./llm.ts";
import { warn } from "./log.ts";
import { filterTickers, loadTickerDirectory } from "./tickers.ts";
import { createVectorStore } from "./vectorstore.ts";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNKNOWN_TICKER: 404,
  UPSTREAM_SEC_ERROR: 502,
  UPSTREAM_QUOTE_ERROR: 502,
  VECTOR_STORE_ERROR: 502,
  LLM_ERROR: 502,
  INTERNAL: 500,
};

function apiError(code: ErrorCode, message: string, detail: string | null = null): ApiError {
  return { error: { code, message, detail } };
}

function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.WEB_ORIGIN ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return Array.from(new Set(["http://localhost:3000", "http://127.0.0.1:3000", ...extra]));
}

function resolveDeps(partial: Partial<Deps> = {}): Deps {
  return {
    embedder: partial.embedder ?? createEmbedder(),
    store: partial.store ?? createVectorStore(),
    llm: partial.llm ?? createLlm(),
    cache: partial.cache ?? new ResearchCache(),
    sec: partial.sec,
    quote: partial.quote,
  };
}

export function createApp(deps: Partial<Deps> = {}): Hono {
  const resolved = resolveDeps(deps);
  const origins = allowedOrigins();
  const app = new Hono();

  app.use(
    "/api/*",
    cors({
      origin: origins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      maxAge: 86400,
    }),
  );

  app.get(ROUTES.health, (c) => c.json({ ok: true as const }));

  /**
   * The full ticker directory, or a ranked subset with `?q=`.
   * `?limit=` (default 25) applies to `?q=` searches only.
   */
  app.get(ROUTES.tickers, (c) => {
    const query = c.req.query("q")?.trim() ?? "";
    const rawLimit = Number(c.req.query("limit"));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 25;
    return c.json(query ? filterTickers(query, limit) : loadTickerDirectory());
  });

  app.post(ROUTES.ask, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(apiError("BAD_REQUEST", "Request body must be JSON"), 400);
    }

    const parsed = AskRequestSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const detail = issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : null;
      return c.json(apiError("BAD_REQUEST", "Invalid request", detail), 400);
    }

    try {
      return c.json(await runAsk(parsed.data, resolved));
    } catch (err) {
      if (err instanceof AskError) {
        const status = STATUS_BY_CODE[err.code];
        if (status >= 500) warn(`${err.code}: ${err.message} (${err.detail ?? "no detail"})`);
        return c.json(apiError(err.code, err.message, err.detail), status as 400);
      }
      const message = err instanceof Error ? err.message : String(err);
      warn(`INTERNAL: ${message}`);
      return c.json(apiError("INTERNAL", "Unexpected server error", message), 500);
    }
  });

  app.notFound((c) => c.json(apiError("BAD_REQUEST", `No route for ${c.req.path}`), 404));

  app.onError((err, c) => {
    warn(`unhandled: ${err.message}`);
    return c.json(apiError("INTERNAL", "Unexpected server error", err.message), 500);
  });

  return app;
}

export const app: Hono = createApp();
