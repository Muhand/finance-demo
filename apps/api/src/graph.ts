import { randomUUID } from "node:crypto";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import {
  AskRequestSchema,
  AskResponseSchema,
  type ApiError,
  type AskRequest,
  type AskResponse,
  type CacheInfo,
  type Chunk,
  type Citation,
  type FilingRef,
  type Quote,
  type SubAnswer,
  type Summary,
  type Timings,
} from "@finance-demo/contracts";

import { ResearchCache } from "./cache.ts";
import { chunkFiling } from "./chunking.ts";
import { mapWithConcurrency } from "./concurrency.ts";
import type { Embedder } from "./embeddings.ts";
import type { FilingMetadata, Llm } from "./llm.ts";
import { warn } from "./log.ts";
import { fetchQuote } from "./quote.ts";
import * as secModule from "./sec.ts";
import { resolveTicker } from "./tickers.ts";
import type { VectorMatch, VectorStore } from "./vectorstore.ts";

export type ErrorCode = ApiError["error"]["code"];

/** Error carrying a contract `ApiError` code, so the HTTP layer can map it. */
export class AskError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | null;

  constructor(code: ErrorCode, message: string, detail: string | null = null) {
    super(message);
    this.name = "AskError";
    this.code = code;
    this.detail = detail;
  }
}

export interface Deps {
  embedder: Embedder;
  store: VectorStore;
  llm: Llm;
  cache: ResearchCache;
  sec?: Partial<typeof import("./sec.js")>;
  quote?: typeof fetchQuote;
}

/** SEC etiquette: never more than this many EDGAR requests in flight. */
export const SEC_CONCURRENCY = 5;

/** Retrieval breadth per sub-agent. */
export const RETRIEVAL_TOP_K = 5;

/** Upper bound on chunks embedded per run, to keep the demo responsive. */
export const MAX_CHUNKS_PER_RUN = 400;

const EMBED_BATCH = 32;

type FilingSections = Array<{ section: string | null; text: string }>;

const AskState = Annotation.Root({
  ticker: Annotation<string>,
  question: Annotation<string>,
  cik: Annotation<string>,
  companyName: Annotation<string>,
  quote: Annotation<Quote | null>,
  latestAccession: Annotation<string | null>,
  hasNewFilings: Annotation<boolean>,
  cache: Annotation<CacheInfo>,
  filings: Annotation<FilingRef[]>,
  sections: Annotation<FilingSections[]>,
  chunkCount: Annotation<number>,
  questions: Annotation<string[]>,
  subAnswers: Annotation<SubAnswer[]>,
  summary: Annotation<Summary | null>,
  timings: Annotation<Partial<Timings>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
  warnings: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
});

type AskStateType = typeof AskState.State;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toCitation(match: VectorMatch): Citation {
  const { chunk, score } = match;
  return {
    accessionNumber: chunk.accessionNumber,
    formType: chunk.formType,
    filingDate: chunk.filingDate,
    section: chunk.section,
    snippet: chunk.text.replace(/\s+/g, " ").trim().slice(0, 400),
    score: Math.max(0, Math.min(1, Number.isFinite(score) ? score : 0)),
    url: chunk.url,
  };
}

/**
 * Builds the request graph described in docs/ARCHITECTURE.md.
 *
 *   resolveTicker
 *     |-- BRANCH A: fetchQuote ----------------------------------+
 *     +-- BRANCH B: checkFilingFreshness                         |
 *            |- new filings -> fetchFilings                      |
 *            |     |- chunkAndEmbed        (parallel)            |
 *            |     +- generateResearchQuestions (parallel)       |
 *            |            -> runSubAgents -> joinResearch -------+
 *            +- no new filings -> loadCachedResearch ------------+
 *                                                                v
 *                                                        synthesize -> persistResearch
 */
export function buildGraph(deps: Deps) {
  const sec = {
    getLatestAccession: deps.sec?.getLatestAccession ?? secModule.getLatestAccession,
    getFilingRefs: deps.sec?.getFilingRefs ?? secModule.getFilingRefs,
    loadFilingSections: deps.sec?.loadFilingSections ?? secModule.loadFilingSections,
  };
  const quoteFn = deps.quote ?? fetchQuote;

  const graph = new StateGraph(AskState)
    /* ---------------------------------------------------------------- */
    .addNode("resolveTicker", async (state: AskStateType) => {
      const entry = resolveTicker(state.ticker);
      if (!entry) {
        throw new AskError(
          "UNKNOWN_TICKER",
          `Unknown ticker "${state.ticker}"`,
          "Not present in the SEC company ticker directory.",
        );
      }
      return { ticker: entry.t, cik: entry.c, companyName: entry.n };
    })

    /* ---------------------------- BRANCH A ---------------------------- */
    .addNode("fetchQuote", async (state: AskStateType) => {
      const started = performance.now();
      let quote: Quote | null = null;
      const warnings: string[] = [];
      try {
        quote = await quoteFn(state.ticker);
      } catch (err) {
        // A quote failure must never fail the request.
        warnings.push(`quote unavailable: ${describe(err)}`);
      }
      return { quote, warnings, timings: { quoteMs: performance.now() - started } };
    })

    /* ---------------------------- BRANCH B ---------------------------- */
    .addNode("checkFilingFreshness", async (state: AskStateType) => {
      const cached = await deps.cache.get(state.ticker);

      let latestAccession: string | null = null;
      let secFailed = false;
      const warnings: string[] = [];
      try {
        latestAccession = await sec.getLatestAccession(state.cik);
      } catch (err) {
        secFailed = true;
        warnings.push(`EDGAR freshness check failed: ${describe(err)}`);
      }

      let hasNewFilings: boolean;
      let reason: CacheInfo["reason"];

      if (!cached) {
        hasNewFilings = true;
        reason = "cold-start";
      } else if (secFailed) {
        // EDGAR is unreachable; prefer serving prior research over failing.
        hasNewFilings = false;
        reason = "no-new-filings-reused";
        latestAccession = cached.lastAccession;
      } else if (cached.subAnswers.length === 0) {
        hasNewFilings = true;
        reason = "cache-miss-rebuilt";
      } else if (cached.lastAccession !== null && cached.lastAccession === latestAccession) {
        hasNewFilings = false;
        reason = "no-new-filings-reused";
      } else {
        hasNewFilings = true;
        reason = "new-filings-detected";
      }

      const cacheInfo: CacheInfo = {
        filingsReused: !hasNewFilings,
        reason,
        lastAccession: latestAccession,
        researchedAt: hasNewFilings ? null : (cached?.researchedAt ?? null),
      };

      return { latestAccession, hasNewFilings, cache: cacheInfo, warnings };
    })

    /**
     * Reuse path: no fetch, no chunking, no embedding, no sub-agents.
     * Synthesis still re-runs against the fresh quote.
     */
    .addNode("loadCachedResearch", async (state: AskStateType) => {
      const cached = await deps.cache.get(state.ticker);
      return {
        filings: cached?.filings ?? [],
        sections: [],
        questions: (cached?.subAnswers ?? []).map((s) => s.question),
        subAnswers: cached?.subAnswers ?? [],
        chunkCount: 0,
        timings: { filingsMs: 0, embedMs: 0, questionGenMs: 0, subAgentsMs: 0 },
      };
    })

    .addNode("fetchFilings", async (state: AskStateType) => {
      const started = performance.now();
      const warnings: string[] = [];
      let filings: FilingRef[] = [];
      let sections: FilingSections[] = [];

      try {
        filings = await sec.getFilingRefs(state.cik, {});
        // Capped at SEC_CONCURRENCY in-flight requests, per EDGAR etiquette.
        sections = await mapWithConcurrency(filings, SEC_CONCURRENCY, async (ref) => {
          try {
            return await sec.loadFilingSections(ref);
          } catch (err) {
            warnings.push(`could not read ${ref.formType} ${ref.accessionNumber}: ${describe(err)}`);
            return [] as FilingSections;
          }
        });
      } catch (err) {
        // A total EDGAR failure. Falling through with zero filings would
        // produce a 200 that is byte-identical to a company that has
        // legitimately never filed, so the client could never tell an outage
        // from an empty state or offer a retry - and we would still burn a
        // question-gen call plus one sub-agent per question to produce an
        // answer we simultaneously label ungrounded. Surface the outage
        // instead, unless there is prior research worth degrading to.
        const cached = await deps.cache.get(state.ticker);
        if (!cached || cached.subAnswers.length === 0) {
          throw new AskError(
            "UPSTREAM_SEC_ERROR",
            `SEC EDGAR is unavailable and no prior research is cached for ${state.ticker}`,
            describe(err),
          );
        }
        warnings.push(`EDGAR filing fetch failed: ${describe(err)}`);
        filings = [];
        sections = [];
      }

      return { filings, sections, warnings, timings: { filingsMs: performance.now() - started } };
    })

    .addNode("chunkAndEmbed", async (state: AskStateType) => {
      const started = performance.now();
      const warnings: string[] = [];

      let chunks: Chunk[] = [];
      state.filings.forEach((filing, i) => {
        chunks.push(...chunkFiling(filing, state.ticker, state.sections[i] ?? []));
      });

      if (chunks.length > MAX_CHUNKS_PER_RUN) {
        warnings.push(`truncated ${chunks.length} chunks to ${MAX_CHUNKS_PER_RUN} for this run`);
        chunks = chunks.slice(0, MAX_CHUNKS_PER_RUN);
      }

      if (chunks.length === 0) {
        return { chunkCount: 0, warnings, timings: { embedMs: performance.now() - started } };
      }

      try {
        // New filings mean the namespace is stale: rebuild it wholesale.
        await deps.store.clearNamespace(state.ticker);
        for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
          const batch = chunks.slice(i, i + EMBED_BATCH);
          const vectors = await deps.embedder.embed(batch.map((c) => c.text));
          await deps.store.upsert(state.ticker, batch, vectors);
        }
      } catch (err) {
        throw new AskError("VECTOR_STORE_ERROR", "Failed to index filings", describe(err));
      }

      return {
        chunkCount: chunks.length,
        warnings,
        timings: { embedMs: performance.now() - started },
      };
    })

    .addNode("generateResearchQuestions", async (state: AskStateType) => {
      const started = performance.now();

      // ARCHITECTURAL REQUIREMENT (docs/ARCHITECTURE.md, "Key constraint"):
      // the question-generation LLM call sees filing METADATA ONLY - form
      // type, filing date, period of report and the NAMES of the available
      // sections. Filing body text is never passed here. Content reaches the
      // model only through sub-agent retrieval from the vector store.
      const metadata: FilingMetadata[] = state.filings.map((filing, i) => ({
        formType: filing.formType,
        filingDate: filing.filingDate,
        periodOfReport: filing.periodOfReport,
        sections: (state.sections[i] ?? []).map((s) => s.section ?? "full-text"),
      }));

      let questions: string[];
      try {
        questions = await deps.llm.generateResearchQuestions({
          userQuestion: state.question,
          ticker: state.ticker,
          filings: metadata,
        });
      } catch (err) {
        throw new AskError("LLM_ERROR", "Failed to plan filing research", describe(err));
      }

      return { questions, timings: { questionGenMs: performance.now() - started } };
    })

    .addNode("runSubAgents", async (state: AskStateType) => {
      const started = performance.now();

      // One sub-agent per generated question, all in parallel. Each has
      // vector-store retrieval as its only tool.
      const subAnswers = await Promise.all(
        state.questions.map(async (question): Promise<SubAnswer> => {
          let matches: VectorMatch[] = [];
          try {
            const [vector] = await deps.embedder.embed([question]);
            if (vector) {
              matches = await deps.store.query(state.ticker, vector, RETRIEVAL_TOP_K);
            }
          } catch (err) {
            warn(`retrieval failed for "${question}": ${describe(err)}`);
          }

          let answer: string;
          try {
            answer = await deps.llm.answerFromContext({ question, matches });
          } catch (err) {
            throw new AskError("LLM_ERROR", "Sub-agent failed to answer", describe(err));
          }

          return {
            question,
            answer,
            citations: matches.map(toCitation),
            grounded: matches.length > 0,
          };
        }),
      );

      return { subAnswers, timings: { subAgentsMs: performance.now() - started } };
    })

    /** Fan-in for the two mutually exclusive Branch B outcomes. */
    .addNode("joinResearch", async () => ({}))

    .addNode("synthesize", async (state: AskStateType) => {
      const started = performance.now();
      let summary: Summary;
      try {
        summary = await deps.llm.synthesize({
          userQuestion: state.question,
          ticker: state.ticker,
          companyName: state.companyName,
          quote: state.quote,
          subAnswers: state.subAnswers,
        });
      } catch (err) {
        if (err instanceof AskError) throw err;
        throw new AskError("LLM_ERROR", "Failed to synthesize an answer", describe(err));
      }
      return { summary, timings: { synthesisMs: performance.now() - started } };
    })

    .addNode("persistResearch", async (state: AskStateType) => {
      if (state.cache.filingsReused) return {};
      // Do not cache a failed research run: without a known head accession or
      // any sub-answers there is nothing worth reusing.
      if (state.latestAccession === null || state.subAnswers.length === 0) return {};
      try {
        await deps.cache.set({
          ticker: state.ticker,
          lastAccession: state.latestAccession,
          researchedAt: new Date().toISOString(),
          filings: state.filings,
          subAnswers: state.subAnswers,
        });
      } catch (err) {
        warn(`failed to persist research for ${state.ticker}: ${describe(err)}`);
      }
      return {};
    })

    /* ------------------------------ edges ----------------------------- */
    .addEdge(START, "resolveTicker")
    .addEdge("resolveTicker", "fetchQuote")
    .addEdge("resolveTicker", "checkFilingFreshness")
    .addConditionalEdges(
      "checkFilingFreshness",
      (state: AskStateType) => (state.hasNewFilings ? "fetchFilings" : "loadCachedResearch"),
      { fetchFilings: "fetchFilings", loadCachedResearch: "loadCachedResearch" },
    )
    .addEdge("fetchFilings", "chunkAndEmbed")
    .addEdge("fetchFilings", "generateResearchQuestions")
    .addEdge(["chunkAndEmbed", "generateResearchQuestions"], "runSubAgents")
    .addEdge("runSubAgents", "joinResearch")
    .addEdge("loadCachedResearch", "joinResearch")
    .addEdge(["fetchQuote", "joinResearch"], "synthesize")
    .addEdge("synthesize", "persistResearch")
    .addEdge("persistResearch", END);

  return graph.compile();
}

function timings(partial: Partial<Timings>, totalMs: number): Timings {
  const round = (value: number | undefined): number => Math.round((value ?? 0) * 1000) / 1000;
  return {
    totalMs: Math.round(totalMs * 1000) / 1000,
    quoteMs: round(partial.quoteMs),
    filingsMs: round(partial.filingsMs),
    embedMs: round(partial.embedMs),
    questionGenMs: round(partial.questionGenMs),
    subAgentsMs: round(partial.subAgentsMs),
    synthesisMs: round(partial.synthesisMs),
  };
}

/** Runs the whole graph and produces a schema-valid `AskResponse`. */
export async function runAsk(req: AskRequest, deps: Deps): Promise<AskResponse> {
  const parsed = AskRequestSchema.safeParse(req);
  if (!parsed.success) {
    throw new AskError("BAD_REQUEST", "Invalid ask request", parsed.error.issues[0]?.message ?? null);
  }

  const askedAt = new Date().toISOString();
  const startedAt = performance.now();

  const final = await buildGraph(deps).invoke({
    ticker: parsed.data.ticker,
    question: parsed.data.question,
  });

  const totalMs = performance.now() - startedAt;

  if (!final.summary) {
    throw new AskError("INTERNAL", "Graph completed without producing a summary");
  }

  if (final.warnings.length > 0) {
    warn(`${parsed.data.ticker}: ${final.warnings.join(" | ")}`);
  }

  return AskResponseSchema.parse({
    requestId: randomUUID(),
    ticker: final.ticker,
    companyName: final.companyName,
    question: parsed.data.question,
    askedAt,
    quote: final.quote ?? null,
    summary: final.summary,
    filings: final.filings ?? [],
    subAnswers: final.subAnswers ?? [],
    cache: final.cache,
    timings: timings(final.timings, totalMs),
  } satisfies AskResponse);
}
