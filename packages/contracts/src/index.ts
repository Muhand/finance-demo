/**
 * FROZEN API CONTRACT — shared by apps/api, apps/web and tests.
 *
 * This file is owned by the integrator. Backend, frontend and QA all code
 * against it. If you believe it needs to change, do NOT edit it: report the
 * needed change upward instead, so all three sides move together.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Ticker directory (preloaded from company_tickers.json)              */
/* ------------------------------------------------------------------ */

export const TickerEntrySchema = z.object({
  /** Ticker symbol, uppercase. e.g. "AAPL" */
  t: z.string(),
  /** Company name as filed with the SEC. e.g. "Apple Inc." */
  n: z.string(),
  /** 10-digit zero-padded CIK. e.g. "0000320193" */
  c: z.string(),
});
export type TickerEntry = z.infer<typeof TickerEntrySchema>;

export const TickerListSchema = z.array(TickerEntrySchema);

/* ------------------------------------------------------------------ */
/* Request                                                             */
/* ------------------------------------------------------------------ */

export const AskRequestSchema = z.object({
  ticker: z.string().trim().min(1).max(10).transform((s) => s.toUpperCase()),
  question: z.string().trim().min(3).max(2000),
});
export type AskRequest = z.infer<typeof AskRequestSchema>;

/* ------------------------------------------------------------------ */
/* Real-time quote                                                     */
/* ------------------------------------------------------------------ */

export const QuoteSchema = z.object({
  symbol: z.string(),
  name: z.string().nullable(),
  price: z.number().nullable(),
  change: z.number().nullable(),
  changePercent: z.number().nullable(),
  currency: z.string().nullable(),
  marketCap: z.number().nullable(),
  dayHigh: z.number().nullable(),
  dayLow: z.number().nullable(),
  volume: z.number().nullable(),
  fiftyTwoWeekHigh: z.number().nullable(),
  fiftyTwoWeekLow: z.number().nullable(),
  peRatio: z.number().nullable(),
  /** ISO-8601 timestamp of the quote. */
  asOf: z.string(),
});
export type Quote = z.infer<typeof QuoteSchema>;

/* ------------------------------------------------------------------ */
/* Filings                                                             */
/* ------------------------------------------------------------------ */

export const FilingRefSchema = z.object({
  accessionNumber: z.string(),
  formType: z.string(),
  /** ISO date, YYYY-MM-DD */
  filingDate: z.string(),
  periodOfReport: z.string().nullable(),
  primaryDocument: z.string().nullable(),
  url: z.string(),
});
export type FilingRef = z.infer<typeof FilingRefSchema>;

export const CitationSchema = z.object({
  accessionNumber: z.string(),
  formType: z.string(),
  filingDate: z.string(),
  /** Filing item/section this chunk came from, e.g. "1A" (Risk Factors). */
  section: z.string().nullable(),
  /** Verbatim excerpt supporting the claim. */
  snippet: z.string(),
  /** Cosine similarity, 0..1. */
  score: z.number(),
  url: z.string(),
});
export type Citation = z.infer<typeof CitationSchema>;

/** One generated research question, answered by a sub-agent over the vector DB. */
export const SubAnswerSchema = z.object({
  question: z.string(),
  answer: z.string(),
  citations: z.array(CitationSchema),
  /** False when the retriever found nothing relevant. */
  grounded: z.boolean(),
});
export type SubAnswer = z.infer<typeof SubAnswerSchema>;

/* ------------------------------------------------------------------ */
/* Synthesized summary — the primary artifact shown to the user        */
/* ------------------------------------------------------------------ */

export const SummarySectionSchema = z.object({
  title: z.string(),
  body: z.string(),
});
export type SummarySection = z.infer<typeof SummarySectionSchema>;

export const SummarySchema = z.object({
  /** One-line answer to the user's question. */
  headline: z.string(),
  /** 2-4 sentence direct answer. */
  narrative: z.string(),
  /** Scannable facts pulled from filings + quote. */
  keyPoints: z.array(z.object({ label: z.string(), detail: z.string() })),
  /** Material risks surfaced from the filings. */
  risks: z.array(z.string()),
  /** Longer organized breakdown, rendered as collapsible sections. */
  sections: z.array(SummarySectionSchema),
});
export type Summary = z.infer<typeof SummarySchema>;

/* ------------------------------------------------------------------ */
/* Cache / freshness                                                   */
/* ------------------------------------------------------------------ */

export const CacheInfoSchema = z.object({
  /** True when EDGAR reported no new filings and the prior research was reused. */
  filingsReused: z.boolean(),
  reason: z.enum([
    "cold-start",
    "new-filings-detected",
    "no-new-filings-reused",
    "cache-miss-rebuilt",
  ]),
  /** Accession number of the newest filing known for this ticker. */
  lastAccession: z.string().nullable(),
  /** ISO-8601 timestamp the reused research was originally produced. */
  researchedAt: z.string().nullable(),
});
export type CacheInfo = z.infer<typeof CacheInfoSchema>;

/* ------------------------------------------------------------------ */
/* Response                                                            */
/* ------------------------------------------------------------------ */

export const TimingsSchema = z.object({
  totalMs: z.number(),
  quoteMs: z.number(),
  filingsMs: z.number(),
  embedMs: z.number(),
  questionGenMs: z.number(),
  subAgentsMs: z.number(),
  synthesisMs: z.number(),
});
export type Timings = z.infer<typeof TimingsSchema>;

export const AskResponseSchema = z.object({
  requestId: z.string(),
  ticker: z.string(),
  companyName: z.string(),
  question: z.string(),
  askedAt: z.string(),
  quote: QuoteSchema.nullable(),
  summary: SummarySchema,
  filings: z.array(FilingRefSchema),
  subAnswers: z.array(SubAnswerSchema),
  cache: CacheInfoSchema,
  timings: TimingsSchema,
});
export type AskResponse = z.infer<typeof AskResponseSchema>;

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      "BAD_REQUEST",
      "UNKNOWN_TICKER",
      "UPSTREAM_SEC_ERROR",
      "UPSTREAM_QUOTE_ERROR",
      "VECTOR_STORE_ERROR",
      "LLM_ERROR",
      "INTERNAL",
    ]),
    message: z.string(),
    /** Safe-to-display detail; never contains secrets. */
    detail: z.string().nullable(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export const ROUTES = {
  /** GET -> TickerEntry[]  (the preloaded company_tickers.json directory) */
  tickers: "/api/tickers",
  /** POST AskRequest -> AskResponse | ApiError */
  ask: "/api/questions",
  /** GET -> { ok: true } */
  health: "/api/health",
} as const;

/* ------------------------------------------------------------------ */
/* Chunking contract (backend implements, QA asserts against)          */
/* ------------------------------------------------------------------ */

/**
 * Simple overlap chunking: split content into `size`-char chunks, and prepend
 * the previous chunk's trailing `overlap` characters to each subsequent chunk.
 */
export const CHUNKING = {
  size: 1800,
  overlap: 200,
} as const;

export const ChunkSchema = z.object({
  id: z.string(),
  ticker: z.string(),
  accessionNumber: z.string(),
  formType: z.string(),
  filingDate: z.string(),
  section: z.string().nullable(),
  chunkIndex: z.number().int().nonnegative(),
  text: z.string(),
  url: z.string(),
});
export type Chunk = z.infer<typeof ChunkSchema>;
