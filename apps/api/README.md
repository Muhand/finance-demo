# `@finance-demo/api`

Node 24 + Hono + LangGraph backend for finance-demo. Serves a real-time quote
plus an LLM-synthesized summary grounded in the company's SEC filings.

Runs on **http://localhost:4000**.

## Run it

```bash
pnpm install                                # from the repo root
pnpm --filter @finance-demo/api start       # or: dev (node --watch)
pnpm --filter @finance-demo/api typecheck
```

TypeScript is executed directly by Node's built-in type stripping (Node >= 22.18,
Node 24 recommended). There is no build step and no bundler. Relative imports
therefore carry explicit `.ts` extensions.

### Zero-credential mode (the default)

With no API keys set, the server boots and answers real requests using
deterministic offline fakes, logging one warning line per substituted
dependency:

```
[finance-demo:api] EMBEDDER is not "local": using the offline HashEmbedder (384d, deterministic). ...
[finance-demo:api] PINECONE_API_KEY is not set: using the in-process MemoryVectorStore (cosine, offline). ...
[finance-demo:api] ANTHROPIC_API_KEY is not set: using the deterministic offline StubLlm. ...
[finance-demo:api] SEC identity set to "FinanceDemo/1.0 (you@example.com)"
[finance-demo:api] listening on http://localhost:4000
```

SEC EDGAR and Yahoo Finance need no credentials, so those calls are real even in
this mode.

## Environment variables

Copy the repo-root `.env.example` to `.env`, or export these directly.

| Variable | Required | Default | Effect |
|---|---|---|---|
| `PORT` | no | `4000` | HTTP port. |
| `WEB_ORIGIN` | no | - | Extra comma-separated CORS origins. `http://localhost:3000` and `http://127.0.0.1:3000` are always allowed. |
| `SEC_USER_AGENT` | no | `FinanceDemo/1.0 (emhsmath@gmail.com)` | Passed to `setIdentity()`. EDGAR requires a descriptive UA on every request. |
| `ANTHROPIC_API_KEY` | no | - | Set to use `AnthropicLlm`. Unset selects `StubLlm`. |
| `ANTHROPIC_SYNTHESIS_MODEL` | no | `claude-sonnet-5` | Model for `synthesize`. |
| `ANTHROPIC_SUBAGENT_MODEL` | no | `claude-haiku-4-5` | Model for question generation and sub-agents. |
| `PINECONE_API_KEY` | no | - | Set to use `PineconeStore`. Unset selects `MemoryVectorStore`. |
| `PINECONE_INDEX` | no | `finance-demo` | Pinecone index name. |
| `EMBEDDER` | no | `hash` | `local` selects `LocalEmbedder` (MiniLM). Anything else selects `HashEmbedder`. |
| `EMBEDDING_MODEL` | no | `Xenova/all-MiniLM-L6-v2` | Only used when `EMBEDDER=local`. |
| `RESEARCH_CACHE_DIR` | no | `apps/api/.data/research` | Where completed research runs are persisted. |
| `TICKERS_PATH` | no | resolved from `@finance-demo/contracts/tickers.json` | Override the ticker directory. |

## Pinecone index requirement

Create the index **before** setting `PINECONE_API_KEY`:

- **dimension: `384`** (must match `EMBEDDING_DIM` / MiniLM-L6-v2)
- **metric: `cosine`**
- **namespace: one per ticker** (`AAPL`, `MSFT`, ...), created implicitly on first upsert

When new filings are detected the ticker's namespace is cleared and rebuilt, so
the index only ever holds chunks from the most recent research run.

## The `EMBEDDER=local` extra

`@huggingface/transformers` is **not** in `package.json`. Its `onnxruntime-node`
dependency unpacks to ~220 MB, which is a heavy default for a workspace whose
offline path never needs it (and which does not fit on every dev machine).
`LocalEmbedder` loads it through a dynamic import, so to enable the real
embedder:

```bash
pnpm --filter @finance-demo/api add @huggingface/transformers
EMBEDDER=local pnpm --filter @finance-demo/api start
```

The first run downloads the model to `.models/`. Without the package installed,
`EMBEDDER=local` fails with a clear message naming the install command.

## Endpoints

All paths come from `ROUTES` in `@finance-demo/contracts`. Failures return the
contract's `ApiError` shape.

| Route | Response |
|---|---|
| `GET /api/health` | `{ "ok": true }` |
| `GET /api/tickers` | `TickerEntry[]` (all 10,391). With `?q=` returns a ranked subset; `?limit=` (default 25) applies to `?q=` only. |
| `POST /api/questions` | `AskRequest` in, `AskResponse` out. |

Status codes: `400` bad request, `404` unknown ticker, `502` upstream/LLM/vector
failure, `500` anything else.

```bash
curl -s localhost:4000/api/health
curl -s 'localhost:4000/api/tickers?q=appl&limit=5'
curl -s -X POST localhost:4000/api/questions \
  -H 'Content-Type: application/json' \
  -d '{"ticker":"AAPL","question":"What are the biggest risks right now?"}'
```

## Request flow

`src/graph.ts` builds the LangGraph `StateGraph` from `docs/ARCHITECTURE.md`:

```
resolveTicker
  |- BRANCH A  fetchQuote ------------------------------------+
  +- BRANCH B  checkFilingFreshness                           |
        |- new filings -> fetchFilings (<=5 in flight)        |
        |     |- chunkAndEmbed            (parallel)          |
        |     +- generateResearchQuestions (parallel)         |
        |            -> runSubAgents -> joinResearch ---------+
        +- no new filings -> loadCachedResearch --------------+
                                                              v
                                                      synthesize -> persistResearch
```

### Freshness gate

`checkFilingFreshness` compares EDGAR's newest accession for the CIK against the
`ResearchCache` record, and reports the outcome in `AskResponse.cache`:

| Situation | `reason` | `filingsReused` |
|---|---|---|
| No cached record | `cold-start` | `false` |
| Cached record has no sub-answers | `cache-miss-rebuilt` | `false` |
| Cached accession differs from EDGAR's newest | `new-filings-detected` | `false` |
| Cached accession matches, or EDGAR is unreachable | `no-new-filings-reused` | `true` |

On reuse, fetch/chunk/embed/sub-agents are **skipped entirely** (their `timings`
come back as `0`) and the saved `subAnswers` + `filings` are reloaded. Synthesis
always re-runs, because the quote is always fresh.

### The metadata-only constraint

`generateResearchQuestions` receives filing **metadata only** (form type, filing
date, period of report, and the *names* of the available sections). Filing body
text is never passed to it. Content reaches the model exclusively through
`answerFromContext`, from sub-agent retrieval against the vector store. The
constraint is enforced by the shape of `FilingMetadata` in `src/llm.ts` and is
commented at both call sites.

## Injecting dependencies

`Deps` (in `src/graph.ts`) is fully injectable, so the whole graph runs offline:

```ts
import { createApp } from "./src/server.ts";
import { runAsk } from "./src/graph.ts";

const deps = {
  embedder: new HashEmbedder(),
  store: new MemoryVectorStore(),
  llm: new StubLlm(),
  cache: new ResearchCache("/tmp/research"),
  sec: { getLatestAccession, getFilingRefs, loadFilingSections },  // all optional
  quote: async () => null,                                        // optional
};

await runAsk({ ticker: "AAPL", question: "..." }, deps);
const app = createApp(deps);   // Partial<Deps>; anything omitted uses create*()
```

`createApp` takes `Partial<Deps>`; whatever is omitted comes from
`createEmbedder()` / `createVectorStore()` / `createLlm()` / `new ResearchCache()`.

## Module map

| File | Purpose |
|---|---|
| `src/chunking.ts` | `chunkText`, `chunkFiling` - overlap chunking per `CHUNKING`. |
| `src/tickers.ts` | `loadTickerDirectory`, `resolveTicker`, `filterTickers`. |
| `src/embeddings.ts` | `Embedder`, `LocalEmbedder`, `HashEmbedder`, `createEmbedder`. |
| `src/vectorstore.ts` | `VectorStore`, `PineconeStore`, `MemoryVectorStore`, `createVectorStore`. |
| `src/llm.ts` | `Llm`, `AnthropicLlm`, `StubLlm`, `createLlm`. |
| `src/sec.ts` | `initSec`, `getLatestAccession`, `getFilingRefs`, `loadFilingSections`. |
| `src/quote.ts` | `fetchQuote`. |
| `src/cache.ts` | `ResearchRecord`, `ResearchCache`. |
| `src/graph.ts` | `Deps`, `buildGraph`, `runAsk`, `AskError`. |
| `src/server.ts` | `createApp`, `app`. |
| `src/index.ts` | Process entrypoint. |
| `src/concurrency.ts` | `mapWithConcurrency` (SEC etiquette cap). |
| `src/log.ts` | `info`, `warn`, `warnOnce`. |

Tests live in `tests/` and are owned by QA. This package contains no test files.
