import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { FilingRef, Quote } from "@finance-demo/contracts";
import { ResearchCache } from "@api/cache";
import { HashEmbedder } from "@api/embeddings";
import { StubLlm } from "@api/llm";
import { MemoryVectorStore } from "@api/vectorstore";
import type { Deps } from "@api/graph";
import {
  AAPL_10K_SECTIONS,
  AAPL_FILINGS,
  NEWEST_ACCESSION,
  makeQuote,
} from "../fixtures/index.js";

/**
 * A fully offline harness for the graph: real offline fakes (StubLlm,
 * MemoryVectorStore, HashEmbedder, ResearchCache on a temp dir) wrapped in
 * spies, plus stubbed SEC and quote functions. Nothing here touches the
 * network, the filesystem outside a temp dir, or any credential.
 */
export interface Harness {
  deps: Deps;
  llm: StubLlm;
  store: MemoryVectorStore;
  embedder: HashEmbedder;
  cache: ResearchCache;
  cacheDir: string;
  spies: {
    embed: ReturnType<typeof vi.spyOn>;
    upsert: ReturnType<typeof vi.spyOn>;
    storeQuery: ReturnType<typeof vi.spyOn>;
    generateResearchQuestions: ReturnType<typeof vi.spyOn>;
    answerFromContext: ReturnType<typeof vi.spyOn>;
    synthesize: ReturnType<typeof vi.spyOn>;
    getLatestAccession: ReturnType<typeof vi.fn>;
    getFilingRefs: ReturnType<typeof vi.fn>;
    loadFilingSections: ReturnType<typeof vi.fn>;
    quote: ReturnType<typeof vi.fn>;
  };
  /** Change what EDGAR reports as the newest accession. */
  setLatestAccession(accession: string | null): void;
  /** Change the filing list EDGAR returns. */
  setFilings(filings: FilingRef[]): void;
  /** Make the quote provider reject, to test graceful degradation. */
  failQuote(message?: string): void;
  cleanup(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const cacheDir = await mkdtemp(join(tmpdir(), "finance-demo-graph-"));

  const embedder = new HashEmbedder();
  const store = new MemoryVectorStore();
  const llm = new StubLlm();
  const cache = new ResearchCache(cacheDir);

  let latestAccession: string | null = NEWEST_ACCESSION;
  let filings: FilingRef[] = AAPL_FILINGS;
  let quoteSeq = 0;
  let quoteError: Error | null = null;

  const getLatestAccession = vi.fn(async (_cik: string) => latestAccession);
  const getFilingRefs = vi.fn(async (_cik: string, _opts?: unknown) => filings);
  const loadFilingSections = vi.fn(async (_ref: FilingRef) => AAPL_10K_SECTIONS);
  const quote = vi.fn(async (_ticker: string): Promise<Quote | null> => {
    if (quoteError) throw quoteError;
    return makeQuote(++quoteSeq);
  });

  const spies = {
    embed: vi.spyOn(embedder, "embed"),
    upsert: vi.spyOn(store, "upsert"),
    storeQuery: vi.spyOn(store, "query"),
    generateResearchQuestions: vi.spyOn(llm, "generateResearchQuestions"),
    answerFromContext: vi.spyOn(llm, "answerFromContext"),
    synthesize: vi.spyOn(llm, "synthesize"),
    getLatestAccession,
    getFilingRefs,
    loadFilingSections,
    quote,
  } as Harness["spies"];

  const deps: Deps = {
    embedder,
    store,
    llm,
    cache,
    sec: { initSec: () => {}, getLatestAccession, getFilingRefs, loadFilingSections },
    quote,
  } as unknown as Deps;

  return {
    deps,
    llm,
    store,
    embedder,
    cache,
    cacheDir,
    spies,
    setLatestAccession(a) {
      latestAccession = a;
    },
    setFilings(f) {
      filings = f;
    },
    failQuote(message = "yahoo-finance2 upstream 503") {
      quoteError = new Error(message);
    },
    async cleanup() {
      vi.restoreAllMocks();
      await rm(cacheDir, { recursive: true, force: true });
    },
  };
}

/** Count of every call that would have cost money or hit the network. */
export function researchWorkCounts(h: Harness) {
  return {
    embed: h.spies.embed.mock.calls.length,
    upsert: h.spies.upsert.mock.calls.length,
    questionGen: h.spies.generateResearchQuestions.mock.calls.length,
    subAgents: h.spies.answerFromContext.mock.calls.length,
    filingFetch: h.spies.getFilingRefs.mock.calls.length,
    sectionLoad: h.spies.loadFilingSections.mock.calls.length,
  };
}
