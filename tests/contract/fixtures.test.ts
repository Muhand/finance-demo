import { describe, expect, it } from "vitest";
import {
  ApiErrorSchema,
  AskResponseSchema,
  CacheInfoSchema,
  ChunkSchema,
  CitationSchema,
  FilingRefSchema,
  QuoteSchema,
  SubAnswerSchema,
  SummarySchema,
} from "@finance-demo/contracts";
import {
  AAPL_FILINGS,
  AAPL_QUOTE,
  ASK_RESPONSE,
  ASK_RESPONSE_REUSED,
  BAD_REQUEST_ERROR,
  CHUNK,
  INTERNAL_ERROR,
  MDA_CITATION,
  NEWER_FILING,
  RISK_CITATION,
  SPARSE_QUOTE,
  SUB_ANSWERS,
  SUMMARY,
  UNKNOWN_TICKER_ERROR,
} from "../fixtures/index.js";

/**
 * The fixtures are the ground truth every other suite builds on. If they drift
 * out of contract, every downstream assertion becomes meaningless — so validate
 * them first and hard.
 */
describe("fixtures satisfy the frozen contract", () => {
  it("FilingRef fixtures parse", () => {
    for (const f of [...AAPL_FILINGS, NEWER_FILING]) {
      expect(() => FilingRefSchema.parse(f)).not.toThrow();
    }
  });

  it("Quote fixtures parse, including the all-null sparse case", () => {
    expect(QuoteSchema.parse(AAPL_QUOTE)).toEqual(AAPL_QUOTE);
    expect(QuoteSchema.parse(SPARSE_QUOTE)).toEqual(SPARSE_QUOTE);
  });

  it("Citation / SubAnswer / Summary / Chunk fixtures parse", () => {
    for (const c of [RISK_CITATION, MDA_CITATION]) CitationSchema.parse(c);
    for (const s of SUB_ANSWERS) SubAnswerSchema.parse(s);
    SummarySchema.parse(SUMMARY);
    ChunkSchema.parse(CHUNK);
  });

  it("AskResponse fixtures parse in both cold and reused states", () => {
    expect(AskResponseSchema.parse(ASK_RESPONSE)).toEqual(ASK_RESPONSE);
    expect(AskResponseSchema.parse(ASK_RESPONSE_REUSED)).toEqual(ASK_RESPONSE_REUSED);
  });

  it("the reused fixture encodes the freshness rule's cache flags", () => {
    expect(ASK_RESPONSE_REUSED.cache).toMatchObject({
      filingsReused: true,
      reason: "no-new-filings-reused",
    });
    expect(ASK_RESPONSE_REUSED.cache.researchedAt).not.toBeNull();
    // Cold start must NOT claim reuse.
    expect(ASK_RESPONSE.cache.filingsReused).toBe(false);
  });

  it("ApiError fixtures parse and `detail` is genuinely nullable", () => {
    for (const e of [UNKNOWN_TICKER_ERROR, BAD_REQUEST_ERROR, INTERNAL_ERROR]) {
      ApiErrorSchema.parse(e);
    }
    expect(INTERNAL_ERROR.error.detail).toBeNull();
  });

  it("accepts every CacheInfo reason the graph can emit, and rejects others", () => {
    const base = { filingsReused: true, lastAccession: "0000320193-24-000123", researchedAt: null };
    for (const reason of [
      "cold-start",
      "new-filings-detected",
      "no-new-filings-reused",
      "cache-miss-rebuilt",
      "upstream-unavailable-stale",
    ]) {
      expect(CacheInfoSchema.safeParse({ ...base, reason }).success, reason).toBe(true);
    }
    expect(CacheInfoSchema.safeParse({ ...base, reason: "made-up" }).success).toBe(false);
  });

  it("rejects an unrecognised error code", () => {
    const bad = { error: { code: "TEAPOT", message: "nope", detail: null } };
    expect(ApiErrorSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an AskResponse missing a required branch", () => {
    const { summary: _dropped, ...withoutSummary } = ASK_RESPONSE;
    expect(AskResponseSchema.safeParse(withoutSummary).success).toBe(false);
  });
});
