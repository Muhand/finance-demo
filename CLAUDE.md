# finance-demo

Single-page finance research app. User picks a ticker, asks a question; the app
returns a real-time quote plus an LLM-synthesized summary grounded in that
company's SEC filings.

## Stack (decided — do not substitute)

| Concern           | Choice |
|-------------------|--------|
| Package manager   | `pnpm` workspaces (never `npm`/`yarn`) |
| Backend           | Node 24 + Hono, TypeScript ESM |
| Orchestration     | `@langchain/langgraph` (StateGraph) |
| LLM               | `@langchain/anthropic` — `claude-sonnet-5` (synthesis), `claude-haiku-4-5-20251001` (sub-agents) |
| Embeddings        | `@huggingface/transformers`, `Xenova/all-MiniLM-L6-v2`, **384 dims**, local, no API key |
| Vector DB         | **Pinecone** (`@pinecone-database/pinecone`), namespace per ticker, cosine |
| SEC filings       | `sec-edgar-toolkit` |
| Quotes            | `yahoo-finance2` (v3 — `new YahooFinance()`) |
| Frontend          | Next.js 16 App Router + React, TypeScript |
| Tests             | `vitest` |

## Workspace layout & OWNERSHIP

Each area has exactly one owner. **Never create or edit files outside your own
area.** If you need something from another area, code against
`@finance-demo/contracts` and report the gap upward.

```
packages/contracts/   INTEGRATOR ONLY — frozen API contract. Read it; never edit it.
apps/api/             BACKEND ENGINEER only.
apps/web/             FRONTEND ENGINEER only.
tests/                QA ENGINEER only.
company_tickers.json  Read-only source data (10,391 tickers).
```

Additional rule: **backend and frontend write no test files.** Every `*.test.ts`
/ `*.spec.ts` in the repo belongs to QA, under `tests/`. This keeps unit-test
ownership in one place and prevents merge conflicts.

## Ports

- API: `http://localhost:4000`
- Web: `http://localhost:3000` (proxies `/api/*` to the API)

## Environment

Copy `.env.example` to `.env`. `ANTHROPIC_API_KEY` and `PINECONE_API_KEY` are
**not** set in this environment. Everything must therefore be built behind
interfaces with working offline fakes, so `pnpm test` passes with zero
credentials and zero network.

## SEC etiquette

EDGAR requires a descriptive `User-Agent`. Always call `setIdentity()` from
`sec-edgar-toolkit` with `SEC_USER_AGENT` before any request, and keep
concurrency to <= 5 in-flight requests.
