# Architecture

## Request flow — `POST /api/questions { ticker, question }`

Orchestrated as a single LangGraph `StateGraph`. The two top branches run in
parallel and join before synthesis.

```
                     ┌───────────────────────────────────────────┐
                     │            resolveTicker                  │
                     │  company_tickers.json -> CIK, name        │
                     └──────────────────┬────────────────────────┘
                                        │
                 ┌──────────────────────┴──────────────────────┐
                 │                                             │
        BRANCH A (always)                            BRANCH B (conditional)
   ┌─────────────────────────┐              ┌──────────────────────────────┐
   │ fetchQuote              │              │ checkFilingFreshness         │
   │ yahoo-finance2          │              │ latest accession vs cache    │
   └─────────────────────────┘              └────────┬──────────────┬──────┘
                                                     │              │
                                          new filings│              │no new filings
                                                     ▼              ▼
                                    ┌────────────────────────┐  ┌─────────────────┐
                                    │ fetchFilings (parallel)│  │ loadCachedRes-  │
                                    │ sec-edgar-toolkit      │  │ earch           │
                                    └──────┬─────────────────┘  │ reuse subAnswers│
                                           │                    └────────┬────────┘
                        ┌──────────────────┴───────────────┐            │
                        │ (these two run in parallel)      │            │
                        ▼                                  ▼            │
            ┌────────────────────────┐      ┌──────────────────────────┐│
            │ chunkAndEmbed          │      │ generateResearchQuestions││
            │ overlap chunking ->    │      │ LLM sees user question + ││
            │ MiniLM 384d -> Pinecone│      │ filing METADATA ONLY     ││
            └───────────┬────────────┘      └────────────┬─────────────┘│
                        └───────────────┬────────────────┘              │
                                        ▼                               │
                        ┌───────────────────────────────┐               │
                        │ runSubAgents (parallel)       │               │
                        │ one sub-agent per question,   │               │
                        │ Pinecone retrieval as a tool  │               │
                        └───────────────┬───────────────┘               │
                                        └──────────────┬────────────────┘
                                                       │
                 ┌─────────────────────────────────────┴───────────┐
                 │ synthesize  (joins Branch A + Branch B)         │
                 │ quote + subAnswers -> Summary                   │
                 └─────────────────────────────────────────────────┘
```

## Node contracts

| Node | Input | Output |
|---|---|---|
| `resolveTicker` | `ticker` | `cik`, `companyName`; `UNKNOWN_TICKER` if absent from directory |
| `fetchQuote` | `ticker` | `Quote \| null` (never fails the request) |
| `checkFilingFreshness` | `cik` | `latestAccession`, `hasNewFilings`, `CacheInfo` |
| `fetchFilings` | `cik` | `FilingRef[]` + extracted item text (10-K/10-Q/8-K, recent N) |
| `chunkAndEmbed` | filing text | `Chunk[]` embedded and upserted to Pinecone namespace `ticker` |
| `generateResearchQuestions` | user question + **filing metadata only** | 3–6 research questions |
| `runSubAgents` | questions | `SubAnswer[]`, each with citations from Pinecone |
| `loadCachedResearch` | `ticker` | previously saved `SubAnswer[]` + `FilingRef[]` |
| `synthesize` | `Quote` + `SubAnswer[]` + user question | `Summary` |

## Freshness rule

`checkFilingFreshness` compares EDGAR's newest accession number for the CIK with
the cached `lastAccession`.

- **Different / no cache** → run the full Branch B, then persist
  `{ lastAccession, filings, subAnswers, researchedAt }`.
- **Same** → skip fetch/chunk/embed/sub-agents entirely, reload the saved
  research, and synthesize it against the **fresh** quote.
  `CacheInfo.filingsReused = true`, `reason = "no-new-filings-reused"`.

Synthesis always re-runs, because the quote is always fresh.

## Chunking

Per `CHUNKING` in the contract: fixed `size` slices, each non-first chunk
prefixed with the previous chunk's trailing `overlap` characters.

## Key constraint

`generateResearchQuestions` receives filing **metadata** (form type, date,
period, available items) — never filing content. Content reaches the LLM only
through sub-agent retrieval from Pinecone.
