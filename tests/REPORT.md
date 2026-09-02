# QA Report — finance-demo

**Owner:** QA engineer (`tests/`, branch `feat/qa`)
**Runner:** `pnpm --filter @finance-demo/tests test` (vitest 4, `tests/vitest.config.ts`)
**Guarantee:** every test in this workspace runs with **zero credentials and zero
network**. Nothing here contacts SEC EDGAR, Yahoo Finance, Anthropic or Pinecone.
Everything that would is injected (`Deps`) or stubbed in `tests/helpers/harness.ts`.

## Current state

```
pnpm --filter @finance-demo/tests test
  Test Files   12 passed (12)
       Tests   130 passed (130)

pnpm --filter @finance-demo/tests typecheck   ->  clean, 0 errors
```

**All green.** Both defects QA raised were fixed during this run and are verified
fixed here — verified by measurement, not by taking the fix reports at face
value. Details in the defect log below.

| Suite | File | Tests |
|---|---|---:|
| contract | `contract/fixtures.test.ts` | 9 |
| contract | `contract/ask-request.test.ts` | 9 |
| contract | `contract/ticker-directory.test.ts` | 6 |
| contract | `contract/transport.test.ts` | 5 |
| unit | `unit/chunking.test.ts` | 25 |
| unit | `unit/tickers.test.ts` | 15 |
| unit | `unit/embeddings.test.ts` | 9 |
| unit | `unit/vectorstore.test.ts` | 8 |
| unit | `unit/cache.test.ts` | 8 |
| integration | `integration/graph.test.ts` | 15 |
| integration | `integration/http.test.ts` | 10 |
| integration | `integration/resilience.test.ts` | 11 |

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
- **Every degraded path is distinguishable from every other**, which was the
  through-line of both defects: a total outage with no usable cache throws
  `UPSTREAM_SEC_ERROR` (502) having spent nothing; an outage with usable cache
  serves it as `upstream-unavailable-stale`; a company that genuinely has no
  filings returns 200 with `filings: []`; and a healthy reuse is
  `no-new-filings-reused`. A client can tell all four apart.
- **The citation invariant**: no sub-answer ever cites an accession absent from
  `filings`, on any path.
- Quote failure degrades to `quote: null` with a 200 and intact research.
- A corrupt cache file is ignored rather than fatal; a cached record with zero
  sub-answers correctly rebuilds as `cache-miss-rebuilt`; a traversing ticker
  (`../../escaped`) does not write outside the cache directory.
- `chunkText` is lossless and surrogate-safe, and handles the
  `String.prototype.slice(-0)` trap (`overlap: 0` yields plain slicing).
- `filterTickers` honours `limit: 0` (i.e. `limit ?? 25`, not `limit || 25`).

### Reproducing these numbers

```
pnpm install
pnpm --filter @finance-demo/tests test
```

Backend modules are resolved through the vitest alias `@api/*` ->
`apps/api/src/*`, not through the package `exports` map.

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

## Defect log

Both defects found during this run have been fixed and independently verified.
Recorded here because the reproductions are the regression tests, and because
the reasoning behind the severity calls is worth keeping.

---

### DEFECT-1 — RESOLVED — `chunkText` split surrogate pairs

**Was:** Medium. Chunk boundaries landed inside UTF-16 surrogate pairs, leaving
lone surrogates that became `U+FFFD` the moment a chunk was UTF-8 encoded — the
HTTP body, the embedding request, and the on-disk research cache. The snippet
shown to the user and the text that was embedded were not what was filed.

Notably this was **not a backend mistake**: the implementation was faithful to
the frozen spec ("slice into `size`-char pieces"), and an independent
reimplementation from `docs/MODULE_MAP.md` corrupted identically. It was routed
to the contract owner rather than patched locally, and the integrator ruled on
the amendment.

**Fix:** `safeBoundary` nudges a boundary forward by one when it falls between a
high and a low surrogate, applied to both the chunk end and the overlap prefix
start. Chunk lengths become `size ± 1`.

**How it was verified.** The original test only asserted that each chunk
survives a UTF-8 round-trip, which the fix satisfies trivially. But nudging the
boundaries means the overlap prefix is now `overlap` *or* `overlap - 1`
characters, so the fixed-width reconstruction check no longer applies to astral
text — the suite could have gone green while the fix silently dropped or
duplicated characters. Two boundary-agnostic tests were added to close that:

- every chunk is a verbatim slice of the source and the chunks tile it with no
  gap (`expectCoversLosslessly`, using non-repetitive astral text so each chunk
  has exactly one position in the source);
- consecutive chunks still genuinely share an overlap window, of `overlap` or
  `overlap - 1` characters, taken from the end of the previous chunk.

Both pass. The fix is lossless.

Two further tests were added after the backend ran an independent randomized
property check over 2000 trials and reported the shared-window shortfall
distribution. Their measurement is now a permanent guard rather than a one-off:

- **the shortfall is at most one character**, measured across three
  `size`/`overlap` pairs. A larger nudge would thin the retrieval overlap
  *without* losing content, so the losslessness test above would not catch it.
  The test also asserts the shortfall-1 case actually occurs in the fixture, so
  it cannot pass vacuously by only exercising clean boundaries.
- **`overlap === 1` stays lossless**, where the shared window can bottom out at
  zero. `safeBoundary` only nudges forward, so a prefix start landing inside a
  pair moves to the chunk start and yields an empty prefix. That is `overlap - 1`
  bottoming out, not separate behaviour, and it is unreachable at the contract's
  1800/200 — but it is reachable through the public `chunkText` API. Pinned so
  nobody "fixes" it by nudging backward, which would take the whole pair and
  produce a 2-character window, larger than the caller asked for.

QA measured a shortfall-1 rate of ~5% across its fixtures versus the backend's
~30%; the difference is fixture astral-density (theirs ~50% astral by
construction, QA's interleaving ASCII and CJK for a more filing-like mix), not a
disagreement. Both bound the shortfall at 1.

**A correction worth recording, because the same trap caught QA twice.** The
first version of both tests measured the shared window with the search capped at
`overlap`. That cap makes a window *larger* than requested read back as exactly
`overlap` — so both tests were blind to the one regression they were written to
catch. The backend implemented the backward-nudging variant and property-tested
it: it tiles correctly, leaves no lone surrogates and loses no content, so it is
a plausible tidy-up rather than an obviously bad change, and its only outward
symptom is a window one character too large. Measured against that variant:

```
fixed assertions   -> 18 over-large windows caught (max excess 1);
                      window of 2 at overlap === 1
previous, capped   -> 0 caught
```

The tests now search with headroom above the requested overlap and assert
`window <= overlap` explicitly. The load-bearing property is *"the window never
exceeds the requested overlap"* — not "backward nudging is unsafe", which the
measurement shows would be wrong. What forward-only actually buys is a single
uniform rule at both the chunk end and the prefix start; backward would need the
two call sites to disagree about direction to keep the end boundary from
stalling.

A chunk-length bound on astral text was added alongside: both boundaries can
move forward by one, so the ASCII invariant relaxes to `size + overlap + 1`
(first chunk `size + 1`). Measured, not assumed — the observed maximum is
exactly `size + overlap + 1`.

**Migration consequence, flagged and actioned:** lone surrogates had already
reached the embedded text and the on-disk cache, so a cache written before the
fix stays corrupt after it. The integrator versioned the cache directory to
`.data/research/v2`.

---

### DEFECT-2 — RESOLVED — a total EDGAR outage was reported as HTTP 200

**Was:** Medium. With SEC unreachable and nothing cached, the request returned
200 with `filings: []`, `reason: "cold-start"`, `lastAccession: null` — byte
identical to a company that has legitimately never filed, so the frontend could
not distinguish an outage from an empty state or offer a retry. It also spent
four Anthropic calls producing an answer it simultaneously labelled ungrounded,
and left `UPSTREAM_SEC_ERROR` unreachable in the frozen enum.

**Fix:** `fetchFilings` throws `AskError("UPSTREAM_SEC_ERROR", ...)` when the SEC
calls hard-fail and the cache yields nothing usable, before `chunkAndEmbed` or
`generateResearchQuestions` are scheduled; `server.ts` maps it to 502.

**Verified:** `runAsk` rejects with `code: "UPSTREAM_SEC_ERROR"`; HTTP returns
502 with a contract-valid `ApiError`; and `questionGen`, `subAgents`, `embed`
and `upsert` counts are all **0** on that path. The zero-spend assertion is kept
as a permanent regression guard, so the early exit cannot quietly drift back
behind the LLM calls.

---

### DEFECT-3 — RESOLVED — a partial EDGAR failure permanently poisoned the cache

**Was:** High. This started as a residual window the backend engineer disclosed
and initially characterised as a narrow "ungrounded 200". Measuring it changed
the severity, which is the reason it is worth recording.

Scenario: `getLatestAccession` succeeds and reports a *new* accession, so the
graph takes the new-filings branch; `getFilingRefs` then fails; usable prior
research exists. Three compounding problems:

1. **It claimed to be grounded.** `filings: []`, yet all three sub-answers
   returned `grounded: true`, citing accessions retrieved from the *previous*
   run's vectors still resident in the namespace. The headline read *"3 of 3
   research questions grounded in SEC filings."* No cited accession appeared in
   `filings`, so a citation could not be linked to a filing.
2. **It persisted an accession it never fetched** — `lastAccession` advanced to
   the new accession alongside `filings: []`.
3. **The damage was permanent.** After EDGAR recovered, the next request matched
   the poisoned accession and returned `no-new-filings-reused` with zero
   re-research, forever; the new filing was never ingested and the ticker served
   `filings: []` until `.data/research` was cleared by hand. A transient blip
   converted a self-healing condition into a permanent one. **That permanence,
   not the single bad response, is what made this High.**

**Fix**, taken in the two halves QA suggested so the already-green reuse path
was not disturbed: `persistResearch` refuses to advance `lastAccession` on any
run whose fetch did not succeed, which removes the permanence on its own; then a
conditional fan-out out of `fetchFilings` diverts to `loadCachedResearch`, so the
cached research is served with `filingsReused: true` and the integrator's new
`reason: "upstream-unavailable-stale"`. The citation invariant was additionally
enforced at source — `runSubAgents` filters retrieval matches against the
accessions in the current request's `filings` — rather than at the response
boundary.

**Verified:** the degraded run reports `upstream-unavailable-stale` with
`filingsReused: true` and a non-null `researchedAt`; the cached sub-answers and
filings are served intact; no expensive work re-runs (only the failed fetch
*attempt*, which is how the outage is discovered); the quote is still fresh;
there are no orphan citations; the persisted `lastAccession` stays on the old
accession; and once EDGAR recovers the new filing is researched and persisted.

**Contract note:** `"upstream-unavailable-stale"` was added to `CacheInfo.reason`
by the integrator, in response to the observation below. The contract suite now
asserts every reason value the graph can emit, and rejects unknown ones.

---

### Observation — RESOLVED

QA flagged that serving stale research during an outage was being reported as
`no-new-filings-reused`, which asserts a check that never happened;
`CacheInfo.reason` had no honest value for it, so no test was written rather
than invent an enum value outside the frozen contract. The integrator added
`"upstream-unavailable-stale"` and it is now asserted on the degraded path.

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
7. **Degraded-path timings.** The backend fixed `filingsMs` being overwritten
   with `0` on the degraded route, which had hidden time actually spent failing.
   No test asserts it: a meaningful threshold would be wall-clock dependent, and
   the existing timings test (finite, non-negative, no leg exceeding the total)
   already covers the shape.
