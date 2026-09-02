# Module map — agreed export names

Backend implements these exactly. QA writes unit tests against these exact
paths and names, and may do so **before** the implementation lands.
Frontend consumes only `@finance-demo/contracts` and HTTP.

## `apps/api/src/chunking.ts`
```ts
export function chunkText(text: string, opts?: { size?: number; overlap?: number }): string[];
export function chunkFiling(
  filing: FilingRef, ticker: string, sections: Array<{ section: string | null; text: string }>,
  opts?: { size?: number; overlap?: number },
): Chunk[];
```
`chunkText` semantics: slice `text` into `size`-char pieces; every piece after
the first is prefixed with the previous piece's trailing `overlap` characters.
Empty/whitespace-only input yields `[]`. `overlap` must be `< size`.

## `apps/api/src/tickers.ts`
```ts
export function loadTickerDirectory(): TickerEntry[];          // memoized
export function resolveTicker(symbol: string): TickerEntry | null;  // case-insensitive, exact
export function filterTickers(query: string, limit?: number): TickerEntry[];
```
`filterTickers` ranking: exact symbol match, then symbol prefix, then name
prefix, then name substring. Case-insensitive. Empty query -> `[]`. Default
`limit` 25.

## `apps/api/src/embeddings.ts`
```ts
export interface Embedder { readonly dim: number; embed(texts: string[]): Promise<number[][]>; }
export class LocalEmbedder implements Embedder {}   // Xenova/all-MiniLM-L6-v2, 384d
export class HashEmbedder implements Embedder {}    // deterministic offline fake, same dim
export function createEmbedder(env?: NodeJS.ProcessEnv): Embedder;
```
Every returned vector is L2-normalized and has length `dim`.

## `apps/api/src/vectorstore.ts`
```ts
export interface VectorMatch { chunk: Chunk; score: number; }
export interface VectorStore {
  upsert(namespace: string, chunks: Chunk[], vectors: number[][]): Promise<void>;
  query(namespace: string, vector: number[], topK: number): Promise<VectorMatch[]>;
  clearNamespace(namespace: string): Promise<void>;
}
export class PineconeStore implements VectorStore {}
export class MemoryVectorStore implements VectorStore {}   // cosine, offline fake
export function createVectorStore(env?: NodeJS.ProcessEnv): VectorStore;
```

## `apps/api/src/llm.ts`
```ts
export interface Llm {
  generateResearchQuestions(input: { userQuestion: string; ticker: string;
    filings: Array<{ formType: string; filingDate: string; periodOfReport: string | null; sections: string[] }>;
  }): Promise<string[]>;                                  // 3..6 questions
  answerFromContext(input: { question: string; matches: VectorMatch[] }): Promise<string>;
  synthesize(input: { userQuestion: string; ticker: string; companyName: string;
    quote: Quote | null; subAnswers: SubAnswer[] }): Promise<Summary>;
}
export class AnthropicLlm implements Llm {}
export class StubLlm implements Llm {}     // deterministic offline fake
export function createLlm(env?: NodeJS.ProcessEnv): Llm;
```

## `apps/api/src/sec.ts`
```ts
export function initSec(env?: NodeJS.ProcessEnv): void;              // setIdentity
export function getLatestAccession(cik: string): Promise<string | null>;
export function getFilingRefs(cik: string, opts?: { forms?: string[]; limit?: number }): Promise<FilingRef[]>;
export function loadFilingSections(ref: FilingRef): Promise<Array<{ section: string | null; text: string }>>;
```

## `apps/api/src/quote.ts`
```ts
export function fetchQuote(ticker: string): Promise<Quote | null>;   // resolves null on upstream failure
```

## `apps/api/src/cache.ts`
```ts
export interface ResearchRecord {
  ticker: string; lastAccession: string | null; researchedAt: string;
  filings: FilingRef[]; subAnswers: SubAnswer[];
}
export class ResearchCache {
  constructor(dir?: string);
  get(ticker: string): Promise<ResearchRecord | null>;
  set(record: ResearchRecord): Promise<void>;
}
```

## `apps/api/src/graph.ts`
```ts
export interface Deps { embedder: Embedder; store: VectorStore; llm: Llm; cache: ResearchCache;
  sec?: Partial<typeof import("./sec.js")>; quote?: typeof fetchQuote; }
export function buildGraph(deps: Deps): ReturnType<StateGraph["compile"]>;
export function runAsk(req: AskRequest, deps: Deps): Promise<AskResponse>;
```
`Deps` is fully injectable so QA can drive the whole graph offline.

## `apps/api/src/server.ts`
```ts
export function createApp(deps?: Partial<Deps>): Hono;
export const app: Hono;
```
