# QA Report — finance-demo

**Owner:** QA engineer (`tests/`, branch `feat/qa`)
**Runner:** `pnpm --filter @finance-demo/tests test` (vitest 4, `tests/vitest.config.ts`)
**Guarantee:** every test in this workspace runs with **zero credentials and zero
network**. Nothing here contacts SEC EDGAR, Yahoo Finance, Anthropic or Pinecone.
Everything that would is injected (`Deps`) or stubbed in `tests/helpers/harness.ts`.

## Current state

```
pnpm --filter @finance-demo/tests test
  Test Files   2 failed | 10 passed (12)
       Tests   4 failed | 119 passed (123)

pnpm --filter @finance-demo/tests typecheck   ->  clean, 0 errors
```

| Suite | File | Tests | Result |
|---|---|---:|---|
| contract | `contract/fixtures.test.ts` | 8 | pass |
| contract | `contract/ask-request.test.ts` | 9 | pass |
| contract | `contract/ticker-directory.test.ts` | 6 | pass |
| contract | `contract/transport.test.ts` | 5 | pass |
| unit | `unit/chunking.test.ts` | 20 | **19 pass / 1 fail** (DEFECT-1) |
| unit | `unit/tickers.test.ts` | 15 | pass |
| unit | `unit/embeddings.test.ts` | 9 | pass |
| unit | `unit/vectorstore.test.ts` | 8 | pass |
| unit | `unit/cache.test.ts` | 8 | pass |
| integration | `integration/graph.test.ts` | 15 | pass |
| integration | `integration/http.test.ts` | 10 | pass |
| integration | `integration/resilience.test.ts` | 10 | **7 pass / 3 fail** (DEFECT-3) |

The 4 failures are two real defects, described below. They are left failing
deliberately; no test was weakened to make the suite green.

**DEFECT-2 was fixed by the backend during this run (`feat/backend` 83b1fba) and
is verified fixed here** — a total EDGAR outage with no cached research now
throws `UPSTREAM_SEC_ERROR` and returns 502, and I independently confirmed it
fails *before* spending anything: question-generation, sub-agent, embed and
upsert counts are all 0 on that path (they were 4 Anthropic calls before). Both
tests now pass and carry a permanent zero-spend regression guard.

**Verified working** (worth stating, because these were the risky parts):

- The **freshness rule** is correct end to end. Cold start researches and
  persists; a second call with the same newest accession sets
  `filingsReused: true` / `reason: "no-new-filings-reused"` and re-runs
  *nothing* expensive — embed, upsert, question-generation, sub-agent and
  filing-fetch call counts are byte-identical across the two runs — while the
  quote is refetched and synthesis re-runs against it. A changed accession
  re-runs the research and repersists. Reuse survives a cold process.
- The **metadata-only constraint** holds. A sentinel planted in the filing body
  never appears in the `generateResearchQuestions` payload, and the payload's
  `filings` entries carry exactly `formType` / `filingDate` / `periodOfReport` /
  `sections`, with `sections` holding section names only.
- Quote failure degrades to `quote: null` with a 200 and intact research.
- A corrupt cache file is ignored rather than fatal; a cached record with zero
  sub-answers correctly rebuilds as `cache-miss-rebuilt`; a traversing ticker
  (`../../escaped`) does not write outside the cache directory.
- `chunkText` handles the `String.prototype.slice(-0)` trap correctly
  (`overlap: 0` yields plain slicing, not duplicated chunks).
- `filterTickers` honours `limit: 0` (i.e. `limit ?? 25`, not `limit || 25`).
- A total EDGAR outage now fails fast with `UPSTREAM_SEC_ERROR` / 502 and zero
  LLM spend, while a company that legitimately has no filings still returns 200
  with `filings: []` — the outage and the empty state are distinguishable.

### Reproducing these numbers

`feat/qa` deliberately contains **no files outside `tests/`**. To run the Phase 2
and Phase 3 suites you need `apps/api` present in the same worktree:

```
git merge feat/backend     # or: git archive feat/backend apps/api | tar -x -C .
pnpm install
pnpm --filter @finance-demo/tests test
```

Backend modules are resolved through the vitest alias `@api/*` ->
`apps/api/src/*`, not through the package `exports` map. The `pnpm-lock.yaml`
in this worktree is untracked on purpose — see the gaps section.


## How the suites are wired

Backend modules are imported through a vitest alias, `@api/*` -> `apps/api/src/*`
(`tests/vitest.config.ts`), rather than through the `@finance-demo/api` package
`exports` map. That keeps QA coupled to `docs/MODULE_MAP.md` — the agreed file
paths and export names — and nothing else. The alias mechanism is verified
working; the suites were written before the implementation landed.

```
tests/
  fixtures/      contract-valid sample data, shared by every suite
  helpers/       createHarness(): a fully offline, fully spied Deps
  contract/      Phase 1 — no dependency on apps/api, runs standalone
  unit/          Phase 2 — one file per module in the module map
  integration/   Phase 3 — the graph and the Hono app end to end
```

## Coverage

### Contract (`tests/contract/`)

| File | What it pins down |
|---|---|
| `fixtures.test.ts` | Every fixture parses against its zod schema (`FilingRef`, `Quote` full + all-null sparse, `Citation`, `SubAnswer`, `Summary`, `Chunk`, `AskResponse` cold + reused, `ApiError`). Also asserts the schemas *reject* an unknown error code and an `AskResponse` missing a required branch, so the fixtures are not passing by accident. |
| `ask-request.test.ts` | `AskRequestSchema` trims and uppercases the ticker (incl. hyphenated `brk-b`), trims but does not otherwise touch the question, rejects empty/whitespace tickers, tickers > 10 chars, questions < 3 chars *after* trimming, questions > 2000 chars, and non-string / missing fields. Includes the boundary cases (exactly 10, exactly 3, exactly 2000) and checks that padding cannot smuggle an over-long question past the limit. |
| `ticker-directory.test.ts` | The shipped `packages/contracts/data/tickers.json` parses as `TickerListSchema`, holds the full 10,391-entry directory, contains AAPL/NVDA/MSFT with the right 10-digit zero-padded CIKs, and has no malformed CIK, no lowercase or empty symbol, no duplicate symbol (a duplicate would make `resolveTicker` ambiguous) and no empty company name. |

### Unit (`tests/unit/`) — against `docs/MODULE_MAP.md`

**`chunking.test.ts` (the highest-value target).** The spec is: slices =
`text[0..size)`, `text[size..2size)`, ...; `chunks[0] = slices[0]`;
`chunks[i] = slices[i-1].slice(-overlap) + slices[i]`.

- empty and whitespace-only input -> `[]`
- text shorter than `size` -> exactly one chunk, byte-identical to the input
- text exactly `size` -> one chunk; `size + 1` -> two, with the second checked
  literally (`"x".repeat(overlap) + "y"`)
- the full construction is compared against an independent reimplementation of
  the spec on a text where every character position is identifiable
- **overlap continuity is asserted on the actual characters**:
  `chunks[i].slice(0, overlap) === chunks[i-1].slice(-overlap)` for every `i`
- **nothing is silently dropped**: `chunks[0] + chunks.slice(1).map(c => c.slice(overlap)).join("")`
  must reconstruct the input exactly — checked on synthetic text, on both real
  10-K fixtures, and on a run of repeated characters
- exact multiples (2x, 3x, 5x `size`) produce exactly N chunks with no trailing
  empty chunk
- size invariants: first chunk is exactly `size`, every other is `<= size + overlap`
- defaults come from `CHUNKING` in the frozen contract (1800 / 200)
- `overlap >= size` is rejected (both `== size` and `> size`)
- `overlap === 0` — this is the `String.prototype.slice(-0)` trap: `-0 === 0`, so
  a naive `prev.slice(-overlap)` returns the *entire* previous slice instead of
  nothing. Asserted against the literal expected output.
- unicode: lossless reconstruction over BMP multi-byte text (CJK, accented
  Latin), and every chunk must survive a UTF-8 round-trip on astral-plane text
  (emoji) — a boundary inside a surrogate pair leaves a lone surrogate that
  becomes U+FFFD the moment the chunk is UTF-8 encoded for an HTTP body, an
  embedding request or the on-disk cache.

`chunkFiling` is checked for contract-valid `Chunk`s, propagated filing
metadata, unique ids, non-negative strictly-increasing `chunkIndex` per section,
full coverage of each section's text, skipping of whitespace-only sections,
retention of `section: null` text, and `[]` for no sections.

**`tickers.test.ts`.** `loadTickerDirectory` returns contract-valid entries and
is memoized (identical array instance). `resolveTicker` is case-insensitive
(`aapl` / `AaPl` / `aApL`), handles single-letter (`V`) and hyphenated (`BRK-B`)
symbols, returns `null` for unknown and empty input, and is *exact* — `AAPLX`
must not fall back to `AAPL`, and `AAP` must resolve to Advance Auto Parts, not
Apple. `filterTickers` returns `[]` for an empty query, puts the exact symbol
match first, and — the sharp one — for query `V`, which hits all four rank tiers
at once (1 exact, ~254 symbol-prefix, ~48 name-prefix, ~1461 name-substring), the
tier sequence of the returned list must be non-decreasing and must never contain
a non-matching entry. Limit is checked at 5, 1, 0 (the `limit || 25` vs
`limit ?? 25` trap) and at the documented default of 25.

**`embeddings.test.ts`.** `HashEmbedder`: `dim === 384` (must match
`LocalEmbedder`, or the offline fake is not a drop-in), one vector per input in
input order (verified by embedding each text alone and comparing to its batch
slot), bit-identical determinism across calls *and across instances* (a restart
must not invalidate the vector store), L2 norm 1 to 6 decimal places, all-finite
values, different texts produce different and not-near-identical vectors, empty
batch and empty strings handled, and a 40-document batch of long filings
produces 40 distinct vectors.

**`vectorstore.test.ts`.** `MemoryVectorStore` with hand-built vectors whose
cosine similarity to the query is known exactly (1.0, 0.6, 0.0, -1.0):
upsert -> query round-trip returns the stored `Chunk` object, ranking is by
descending cosine with the scores checked numerically, an unnormalised query
vector gives the same ranking and scores, `topK` is honoured at 1/2/100,
namespaces are isolated (and an unknown namespace returns `[]`), re-upserting the
same chunk id replaces rather than duplicates, `clearNamespace` empties only its
target and is a no-op (not a throw) on an unknown namespace, and an empty upsert
is tolerated.

**`cache.test.ts`.** `ResearchCache` against a fresh `mkdtemp` directory per
test: miss -> `null`; full round-trip preserving nested citations; **persistence
across instances** (a new `ResearchCache` over the same dir sees the record);
creation of a not-yet-existing directory; per-ticker isolation; overwrite rather
than append; a `null` `lastAccession` (a company with no filings); and a
path-traversal guard — a ticker of `../../escaped` must not cause a write above
the cache directory.

### Integration (`tests/integration/`)

`helpers/harness.ts` builds a `Deps` from the real offline fakes (`StubLlm`,
`MemoryVectorStore`, `HashEmbedder`, `ResearchCache` on a temp dir) with
`vi.spyOn` on every method that costs money or network, plus `vi.fn` stubs for
`getLatestAccession` / `getFilingRefs` / `loadFilingSections` / `fetchQuote`. The
quote stub returns a *different* `asOf` and price on every call, so "was the
quote refetched?" is directly observable.

**`graph.test.ts`**

- a full run returns a response satisfying `AskResponseSchema.parse()`
- ticker resolution, request echo, `requestId`, parseable `askedAt`
- 3-6 sub-answers, every citation pointing at an ingested accession, scores in
  `[-1, 1]`, at least one grounded
- chunks are upserted into the ticker's own namespace
- determinism: the same request twice yields the same summary
- **the freshness rule** (the headline requirement):
  - *cold start* -> `filingsReused: false`, `reason: "cold-start"`, research
    actually runs (embed > 0, one question-gen call, >= 3 sub-agent calls), and
    the record is persisted with the right accession, filings and sub-answers
  - *same accession* -> `filingsReused: true`,
    `reason: "no-new-filings-reused"`, `researchedAt` non-null, and
    **every expensive call count is byte-identical to the previous run** (a
    single `toEqual` over embed / upsert / question-gen / sub-agent / filing-fetch
    / section-load counts), the sub-answers and filings equal the first run's,
    while the quote stub was called once more, the returned quote has a *newer*
    `asOf`, and `synthesize` ran a second time. `getLatestAccession` is still
    called — that check is the whole point of the rule.
  - *changed accession* -> `filingsReused: false`,
    `reason: "new-filings-detected"`, new accession persisted, and embed /
    question-gen / sub-agent counts all strictly increase
  - *cold process* -> a brand-new harness pointed at the same cache directory
    still reuses, with zero embed calls
- **the metadata-only constraint**: a sentinel string (`BODY_SENTINEL`) is
  planted in the 10-K prose fixture. The spy on `llm.generateResearchQuestions`
  is asserted to have received a payload whose JSON does not contain the
  sentinel, and whose `filings` entries have *exactly* the four keys
  `formType` / `filingDate` / `periodOfReport` / `sections`, with `sections`
  being short strings (section names, not section text). A companion test
  confirms content *does* reach the LLM through `answerFromContext`, i.e. the
  sanctioned retrieval path.
- graceful degradation: a rejecting quote provider yields `quote: null` with a
  still-valid response and intact research; a company with no filings still
  returns a valid response with `lastAccession: null`; an unknown ticker rejects
  without touching EDGAR or the embedder
- timings are finite and non-negative, and — since the two branches run in
  parallel — the largest leg does not exceed `totalMs`

**`http.test.ts`** drives the Hono app from `createApp(deps)`:

- `GET /api/health` -> 200 `{ ok: true }`
- `GET /api/tickers` -> 200, parses as `TickerListSchema`, full directory
- `POST /api/questions` -> 200 + `AskResponseSchema`, with the ticker
  normalised and the company resolved
- the summary is not a raw filing dump (bounded lengths, no `BODY_SENTINEL`)
- unknown ticker -> 4xx + `ApiErrorSchema` with `code: "UNKNOWN_TICKER"`
- six malformed bodies -> 400 + `code: "BAD_REQUEST"`
- a syntactically invalid JSON body -> 400 `BAD_REQUEST`, not 500
- quote provider down -> still 200 with `quote: null`
- error bodies contain no credential names or key prefixes
- an unknown path -> 404

## Defects and spec deviations

Three failing tests, two distinct defects.

---

### DEFECT-1 — `chunkText` splits surrogate pairs, corrupting astral characters

**Severity:** Medium (silent data corruption; low frequency in practice)
**File:** `apps/api/src/chunking.ts`, `chunkText`
**Test:** `tests/unit/chunking.test.ts` -> *"every chunk survives a UTF-8
round-trip — no chunk boundary corrupts a character"*

**Expected:** every chunk is a well-formed string, so
`Buffer.from(chunk, "utf8").toString("utf8") === chunk`.

**Actual:** chunk boundaries land inside UTF-16 surrogate pairs, leaving lone
surrogates at chunk edges. Chunks 0, 3 and 8 of the test input fail the
round-trip. The lone surrogate becomes `U+FFFD` the moment the chunk is UTF-8
encoded — which happens on the HTTP response body, on the way into an embedding
request, and on the way into the on-disk research cache. So the citation snippet
the user sees, and the text that was embedded, are not the text that was filed.

**Reproduce:**

```js
const text = "📈📉💹🧾🏦 quarterly results 🚀".repeat(40);
const chunks = chunkText(text, { size: 100, overlap: 20 });
Buffer.from(chunks[0], "utf8").toString("utf8") === chunks[0];  // false
chunks[0].slice(-1).charCodeAt(0);                              // 0xD83D — lone high surrogate
```

**Important nuance — this is a spec gap, not an implementation bug.** The
implementation is *faithful* to the frozen spec ("slice into `size`-char
pieces"), and an independent reimplementation of that spec from
`docs/MODULE_MAP.md` reproduces the corruption identically. So the fix belongs
to whoever owns the contract, not to the backend engineer acting alone.

**Suggested fix** (backend, ~3 lines, once the integrator agrees): after
computing each boundary, nudge it forward by one if it lands between a high and
a low surrogate.

```ts
const safe = (s: string, i: number) =>
  i > 0 && i < s.length &&
  s.charCodeAt(i - 1) >= 0xd800 && s.charCodeAt(i - 1) <= 0xdbff &&
  s.charCodeAt(i) >= 0xdc00 && s.charCodeAt(i) <= 0xdfff
    ? i + 1
    : i;
```

This keeps every other invariant intact (chunk lengths become `size ± 1`, which
the existing tests already allow, and lossless reconstruction still holds
because the overlap prefix is computed from the same adjusted boundary). If the
integrator instead decides code-unit slicing is acceptable, amend `CHUNKING` in
`packages/contracts/src/index.ts` to say so explicitly and I will drop the test.

---

### DEFECT-2 — RESOLVED — a total EDGAR outage was reported as HTTP 200

**Status:** fixed by the backend in `feat/backend` 83b1fba, independently
verified here. `fetchFilings` now throws
`AskError("UPSTREAM_SEC_ERROR", ...)` when the SEC calls hard-fail and the cache
yields nothing usable, before `chunkAndEmbed` or `generateResearchQuestions` are
scheduled; `server.ts` maps it to 502 with a contract-valid `ApiError` body.

Verified independently, not taken on trust: `runAsk` rejects with
`code: "UPSTREAM_SEC_ERROR"`; `questionGen`, `subAgents`, `embed` and `upsert`
call counts are all **0** on that path; a company that genuinely has no filings
still returns 200 with `filings: []`; and the outage-with-warm-cache path is
byte-for-byte unchanged and still passing. The zero-spend assertion is now a
permanent regression guard in
`tests/integration/resilience.test.ts`.

---

### DEFECT-3 — a partial EDGAR failure permanently poisons the research cache

**Severity:** High
**File:** `apps/api/src/graph.ts` (new-filings branch + `persistResearch`)
**Tests:** `tests/integration/resilience.test.ts` -> *"partial EDGAR failure —
accession readable, filing bodies not"* (3 failing)

This is the residual window the backend engineer flagged and chose not to close.
Having measured it, it is materially worse than "an ungrounded 200", and I think
it now outranks DEFECT-1.

**Setup:** `getLatestAccession` succeeds and reports a *new* accession, so the
graph takes the new-filings branch; `getFilingRefs` then fails; usable prior
research exists in the cache. (`tests/helpers/harness.ts` -> `failFilingFetch()`.)

**Expected:** either serve the cached research, or fail with
`UPSTREAM_SEC_ERROR`. Either way, do not record the new accession as researched.

**Actual — three compounding problems:**

1. **The response claims to be grounded when it is not, and is internally
   inconsistent.** `filings: []`, yet all three sub-answers come back
   `grounded: true`, citing accessions `…24-000123`, `…24-000081`,
   `…24-000069` — retrieved from the *previous* run's vectors, which are still
   sitting in the `AAPL` namespace. The summary headline reads
   *"3 of 3 research questions grounded in SEC filings."* Every citation
   references an accession that is absent from `filings`, so a frontend that
   links a citation to its filing has nothing to link to.

2. **It persists an accession it never fetched.** The cache record is written as
   `lastAccession: "0000320193-25-000004"` with `filings: []` — claiming the new
   10-Q was researched when nothing from it was ever fetched, embedded or read.

3. **The damage is permanent, and this is the serious part.** Once EDGAR
   recovers, the next request compares the (real) newest accession against the
   poisoned `lastAccession`, finds them equal, and returns
   `reason: "no-new-filings-reused"`, `filingsReused: true`, with **zero**
   re-research — forever. Verified: after recovery, `embed`, `questionGen`,
   `subAgents`, `filingFetch` are all 0 and `filings` stays empty. A transient
   blip converts a self-healing condition into a permanent one; the new filing
   is never ingested, and the ticker serves `filings: []` from then on. Only
   manually clearing `.data/research` recovers it.

**Reproduce:**

```ts
const h = await createHarness();
await runAsk(req, h.deps);                     // warm cache, accession …24-000123
h.setLatestAccession("0000320193-25-000004");  // a new filing appears
h.failFilingFetch();                           // ...but its body can't be fetched
await runAsk(req, h.deps);                     // 200, "3 of 3 grounded", filings: []
(await h.cache.get("AAPL")).lastAccession;     // "0000320193-25-000004"  <-- poisoned
// EDGAR recovers:
(await runAsk(req, deps)).cache.reason;        // "no-new-filings-reused", 0 work done
```

**Suggested fix, smallest first.** The cheap half fixes the permanence without
touching the graph's routing, which is what the backend was rightly wary of:
in `persistResearch`, refuse to write `lastAccession` when the filing fetch did
not succeed — keep the previously cached accession, so the next request retries
naturally. That alone downgrades this from permanent corruption to one bad
response. The fuller fix — re-routing mid-branch to `loadCachedResearch` when
`getFilingRefs` fails and usable research exists — can follow separately, and
the invariant in point 1 (every cited accession must appear in `filings`) is
worth asserting in the graph regardless of which route is taken.

---

### Observation (no test, no fix requested) — reason code when EDGAR is down but cached

When EDGAR is unreachable and prior research *is* cached, the response reports
`reason: "no-new-filings-reused"`. Serving the cache is the right call, but the
reason is slightly untrue: nothing confirmed there are no new filings — EDGAR
was never reached. `CacheInfo.reason` has no enum value for "served stale
because upstream was unavailable", so there is nothing better to return today.
Flagging it for the contract owner; no test asserts it, because asserting it
would mean inventing an enum value that is not in the frozen contract.


## Gaps not covered

1. **`LocalEmbedder`, `PineconeStore`, `AnthropicLlm`, `sec.ts`, `quote.ts`.**
   All four reach the network or a downloaded model, so they are excluded by the
   zero-network rule. What *is* covered is that the graph never depends on them
   directly — everything flows through `Deps`. Their real behaviour needs a
   separate, credentialed, opt-in suite.
2. **Retrieval quality.** `StubLlm` makes the pipeline deterministic, which is
   what integration tests need, but it means no test says anything about whether
   the real prompts produce good research questions or well-grounded answers.
   That needs an eval harness, not a unit test.
3. **Embedding semantics.** `HashEmbedder` is deterministic but not semantic, so
   "does retrieval surface the *relevant* chunk" is untestable offline. The
   vector-store tests use hand-built vectors precisely to keep the ranking
   assertions independent of embedding quality.
4. **Concurrency.** The architecture calls for parallel branches and <= 5
   in-flight SEC requests. Nothing here asserts the concurrency cap, because
   asserting it deterministically requires instrumentation the module map does
   not expose.
5. **Frontend.** `apps/web/` has no tests in this suite — no component,
   accessibility or end-to-end browser coverage.
6. **`GET /api/tickers` search.** The frozen contract types this route as
   returning the whole directory, with no query-parameter search. The frontend
   typeahead over 10,391 entries will want server-side filtering
   (`filterTickers` already exists for it), but since the contract does not
   specify a `?q=` parameter, no test asserts one. Flagging it as a contract gap
   for the integrator rather than testing an unagreed interface.
7. **`pnpm-lock.yaml`.** Deliberately not committed on `feat/qa`: all three
   branches regenerate it, and committing three divergent lockfiles guarantees a
   merge conflict. The integrator should generate one lockfile after merging.
