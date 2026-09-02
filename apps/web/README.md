# `@finance-demo/web`

The single-page front end. Next.js 16 (App Router) + React 19, TypeScript, plain
CSS Modules — no component library.

## Run it

From the repo root:

```bash
pnpm install
pnpm --filter @finance-demo/web dev     # http://localhost:3000
```

The API is expected on `http://localhost:4000`. Start it in another terminal
(`pnpm --filter @finance-demo/api dev`).

Other scripts:

```bash
pnpm --filter @finance-demo/web typecheck   # tsc --noEmit
pnpm --filter @finance-demo/web build       # next build
pnpm --filter @finance-demo/web start       # serve the production build
```

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `API_ORIGIN` | `http://localhost:4000` | Where `/api/*` is proxied. Read at **server** start by `next.config.ts` — changing it requires a restart of `next dev` / `next start`. |
| `NEXT_PUBLIC_FIXTURES` | unset | Set to `1` to run the UI against in-repo fixtures instead of the API. **Development only** — see below. |

The browser never calls the API cross-origin. `next.config.ts` declares a
rewrite so `/api/:path*` on port 3000 is proxied to `${API_ORIGIN}/api/:path*`,
which keeps every request same-origin (no CORS, no client-side base URL) and
makes the API host a deploy-time concern rather than a bundled constant.

```bash
API_ORIGIN=http://127.0.0.1:4100 pnpm --filter @finance-demo/web dev
```

### Fixture mode

`NEXT_PUBLIC_FIXTURES=1` swaps both network calls for the fixtures in
`src/fixtures/sample.ts` (a 10-row ticker list and one fully-populated
`AskResponse`, with an artificial 4s delay so the progressive loading state is
visible). It exists so the UI can be developed and demoed while the backend is
still being built. The shipped default is unset, so the app always calls the
real `/api/*` routes.

```bash
NEXT_PUBLIC_FIXTURES=1 pnpm --filter @finance-demo/web dev
```

## What the app does

**State 1 — ticker picker.** On mount the app fetches the whole SEC company
directory once from `GET /api/tickers` (~10.4k rows) and keeps it in memory.
Typing filters that array client-side; nothing is re-fetched per keystroke.
Ranking (`src/lib/rank.ts`) mirrors the contract's ordering: exact symbol →
symbol prefix → name prefix → name substring, case-insensitive, ties broken on
symbol length then alphabetically, capped at 25 rendered rows. The input is an
ARIA combobox: ↑/↓ move, Enter selects, Esc clears then dismisses, Home/End jump.
Rendering (not fetching) is deferred with `useDeferredValue` so keystrokes stay
on the fast path.

If `GET /api/tickers` fails the picker degrades instead of dying: it shows the
real error code and accepts a free-text symbol, so the app is still usable with
no directory.

**State 2 — the split.** Once a ticker is chosen the view becomes two panels.
The ratio is **35% question / 65% summary** — deliberately not 50/50, because
the summary is the product and the question box is just an input. It is declared
once as CSS custom properties in `src/app/globals.css`:

```css
--split-left: 35fr;
--split-right: 65fr;
```

and consumed in exactly one place, `.split` in `src/components/ui.module.css`:

```css
grid-template-columns: var(--split-left) var(--split-right);
```

so the ratio cannot drift between breakpoints. Below 980px the grid collapses to
one column and the summary is ordered *first*, keeping the same priority.

**The answer.** `POST /api/questions` returns an `AskResponse`, rendered as: the
live quote (colour-coded, with day/52-week range markers, every field
null-tolerant) → cache/freshness note → headline → narrative → key points →
risks → collapsible detail sections → the filings used (linking to sec.gov) →
sub-answers, each expandable to its verbatim citations with retrieval scores →
a timing breakdown bar.

**States.** The request runs a multi-second LLM pipeline, so loading walks the
real pipeline stages (quote → filings → embed → plan → sub-agents → synthesis)
with a truthful elapsed clock and an asymptotic progress bar; stage timing is an
estimate and says so. Errors render the contract's `ApiError` with per-code copy
(`UNKNOWN_TICKER`, `LLM_ERROR`, …), and a network failure is distinguished from
an API error so "the backend isn't running" reads as exactly that. The ticker can
be changed from the masthead at any time with no reload, and every question asked
this session stays in a list on the left — click one to bring its answer back.

## Layout of the source

```
src/app/layout.tsx        html shell + metadata
src/app/globals.css       design tokens (light/dark), the split ratio
src/app/page.tsx          renders <ResearchApp/>
src/components/
  ResearchApp.tsx         all app state: directory, selection, history, panel state
  TickerPicker.tsx        the ARIA combobox (hero + compact variants)
  QuestionPanel.tsx       LEFT panel (35%)
  SummaryPanel.tsx        RIGHT panel (65%) — idle / loading / error / result
  AnswerView.tsx          the rendered AskResponse
  QuoteCard.tsx           live quote, null-tolerant
  Evidence.tsx            sub-answers + citations
  Disclosure.tsx          accessible collapsible
  icons.tsx, ui.module.css
src/lib/
  api.ts                  fetch wrappers + normalised RequestFailure + error copy
  rank.ts                 client-side ticker ranking
  format.ts               null-tolerant number/date formatters
  progress.ts             pipeline stage pacing for the loading state
  session.ts              history entry + panel state types
src/fixtures/sample.ts    dev-only, gated behind NEXT_PUBLIC_FIXTURES
```

Types come from `@finance-demo/contracts` only; nothing here re-declares the
API shape.

## A note on `AGENTS.md` / `CLAUDE.md` in this directory

`next dev` writes an `apps/web/AGENTS.md` (plus a one-line `CLAUDE.md` that
includes it) on every start, containing Next.js 16's own instructions for coding
agents. They are listed in `apps/web/.gitignore` rather than committed: adopting
repo-wide agent instructions is an integrator decision, not the front end's.
Untracking them also keeps the tree clean, since `next dev` recreates them
regardless. If the team wants them, drop the two lines from `.gitignore` and
commit them.
