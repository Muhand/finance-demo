import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AskRequestSchema, AskResponseSchema } from "@finance-demo/contracts";
import { runAsk } from "@api/graph";
import { createHarness, researchWorkCounts, type Harness } from "../helpers/harness.js";
import { AAPL_FILINGS, BODY_SENTINEL, NEWER_ACCESSION, NEWER_FILING, NEWEST_ACCESSION } from "../fixtures/index.js";

const ask = (question = "How is the gross margin trending and what are the risks?") =>
  AskRequestSchema.parse({ ticker: "aapl", question });

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

describe("runAsk — full offline pipeline", () => {
  it("returns a response that satisfies AskResponseSchema", async () => {
    const res = await runAsk(ask(), h.deps);
    expect(() => AskResponseSchema.parse(res)).not.toThrow();
  });

  it("resolves the ticker to its company and echoes the normalised request", async () => {
    const res = await runAsk(ask("What drove revenue growth?"), h.deps);
    expect(res.ticker).toBe("AAPL");
    expect(res.companyName).toBe("Apple Inc.");
    expect(res.question).toBe("What drove revenue growth?");
    expect(res.requestId).toBeTruthy();
    expect(Number.isNaN(Date.parse(res.askedAt))).toBe(false);
  });

  it("returns grounded sub-answers whose citations point at the ingested filings", async () => {
    const res = await runAsk(ask(), h.deps);
    expect(res.subAnswers.length).toBeGreaterThanOrEqual(3);
    expect(res.subAnswers.length).toBeLessThanOrEqual(6);
    const accessions = new Set(AAPL_FILINGS.map((f) => f.accessionNumber));
    for (const sa of res.subAnswers) {
      for (const c of sa.citations) {
        expect(accessions.has(c.accessionNumber)).toBe(true);
        expect(c.score).toBeGreaterThanOrEqual(-1);
        expect(c.score).toBeLessThanOrEqual(1);
      }
    }
    expect(res.subAnswers.some((sa) => sa.grounded)).toBe(true);
  });

  it("embeds and upserts chunks into the ticker's own namespace", async () => {
    await runAsk(ask(), h.deps);
    expect(h.spies.upsert.mock.calls.length).toBeGreaterThan(0);
    for (const call of h.spies.upsert.mock.calls) expect(call[0]).toBe("AAPL");
  });

  it("is deterministic — the same request twice produces the same summary", async () => {
    const a = await runAsk(ask(), h.deps);
    const b = await runAsk(ask(), h.deps);
    expect(b.summary).toEqual(a.summary);
  });
});

describe("freshness rule (docs/ARCHITECTURE.md)", () => {
  it("cold start does the full research and records the accession", async () => {
    const res = await runAsk(ask(), h.deps);
    expect(res.cache.filingsReused).toBe(false);
    expect(res.cache.reason).toBe("cold-start");
    expect(res.cache.lastAccession).toBe(NEWEST_ACCESSION);

    const work = researchWorkCounts(h);
    expect(work.embed).toBeGreaterThan(0);
    expect(work.questionGen).toBe(1);
    expect(work.subAgents).toBeGreaterThanOrEqual(3);

    // ...and persists it, so a restart can reuse it.
    const persisted = await h.cache.get("AAPL");
    expect(persisted).not.toBeNull();
    expect(persisted!.lastAccession).toBe(NEWEST_ACCESSION);
    expect(persisted!.subAnswers.length).toBe(res.subAnswers.length);
    expect(persisted!.filings).toEqual(AAPL_FILINGS);
  });

  it("SAME accession -> reuses research, re-runs nothing expensive, still refetches the quote", async () => {
    const first = await runAsk(ask(), h.deps);
    const after1 = researchWorkCounts(h);
    const quoteCallsAfter1 = h.spies.quote.mock.calls.length;

    const second = await runAsk(ask(), h.deps);

    // The headline flags.
    expect(second.cache.filingsReused).toBe(true);
    expect(second.cache.reason).toBe("no-new-filings-reused");
    expect(second.cache.lastAccession).toBe(NEWEST_ACCESSION);
    expect(second.cache.researchedAt).not.toBeNull();

    // Nothing expensive re-ran: no re-embed, no re-upsert, no question
    // generation, no sub-agents, no filing body fetch.
    expect(researchWorkCounts(h)).toEqual(after1);

    // The research itself is the saved research.
    expect(second.subAnswers).toEqual(first.subAnswers);
    expect(second.filings).toEqual(first.filings);

    // But the quote IS fresh, and synthesis re-ran against it.
    expect(h.spies.quote.mock.calls.length).toBe(quoteCallsAfter1 + 1);
    expect(second.quote).not.toBeNull();
    expect(second.quote!.asOf).not.toBe(first.quote!.asOf);
    expect(h.spies.synthesize.mock.calls.length).toBe(2);

    // EDGAR was still consulted for the newest accession — that is the check.
    expect(h.spies.getLatestAccession.mock.calls.length).toBe(2);
  });

  it("CHANGED accession -> re-runs the research", async () => {
    await runAsk(ask(), h.deps);
    const after1 = researchWorkCounts(h);

    h.setLatestAccession(NEWER_ACCESSION);
    h.setFilings([NEWER_FILING, ...AAPL_FILINGS]);
    const res = await runAsk(ask(), h.deps);

    expect(res.cache.filingsReused).toBe(false);
    expect(res.cache.reason).toBe("new-filings-detected");
    expect(res.cache.lastAccession).toBe(NEWER_ACCESSION);

    const after2 = researchWorkCounts(h);
    expect(after2.embed).toBeGreaterThan(after1.embed);
    expect(after2.questionGen).toBe(after1.questionGen + 1);
    expect(after2.subAgents).toBeGreaterThan(after1.subAgents);

    // The new accession is now what gets persisted.
    expect((await h.cache.get("AAPL"))!.lastAccession).toBe(NEWER_ACCESSION);
  });

  it("reuse survives a cold process — a brand new harness over the same cache dir reuses", async () => {
    await runAsk(ask(), h.deps);
    const fresh = await createHarness();
    try {
      // Point the new harness at the first harness's cache directory.
      const deps = { ...fresh.deps, cache: h.cache };
      const res = await runAsk(ask(), deps);
      expect(res.cache.reason).toBe("no-new-filings-reused");
      expect(res.cache.filingsReused).toBe(true);
      expect(researchWorkCounts(fresh).embed).toBe(0);
    } finally {
      await fresh.cleanup();
    }
  });
});

describe("metadata-only constraint (docs/ARCHITECTURE.md 'Key constraint')", () => {
  it("generateResearchQuestions never receives filing body text", async () => {
    await runAsk(ask(), h.deps);
    expect(h.spies.generateResearchQuestions).toHaveBeenCalledTimes(1);

    const [input] = h.spies.generateResearchQuestions.mock.calls[0] as [{
      userQuestion: string;
      ticker: string;
      filings: Array<Record<string, unknown>>;
    }];

    // The sentinel lives only in the filing prose. If it shows up anywhere in
    // the payload, filing content leaked into the question-generation prompt.
    expect(JSON.stringify(input)).not.toContain(BODY_SENTINEL);

    // And nothing else from the body either: no long prose fields.
    expect(input.ticker).toBe("AAPL");
    expect(input.userQuestion.length).toBeLessThanOrEqual(2000);
    expect(Array.isArray(input.filings)).toBe(true);
    expect(input.filings.length).toBeGreaterThan(0);

    for (const f of input.filings) {
      expect(Object.keys(f).sort()).toEqual(["filingDate", "formType", "periodOfReport", "sections"]);
      expect(typeof f.formType).toBe("string");
      expect(typeof f.filingDate).toBe("string");
      // `sections` is a list of section NAMES, not section text.
      expect(Array.isArray(f.sections)).toBe(true);
      for (const s of f.sections as unknown[]) {
        expect(typeof s).toBe("string");
        expect((s as string).length).toBeLessThan(64);
      }
    }
  });

  it("filing content reaches the LLM only through sub-agent retrieval", async () => {
    await runAsk(ask(), h.deps);
    // Sub-agents DO get content — that is the sanctioned path.
    const subAgentPayloads = h.spies.answerFromContext.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(subAgentPayloads.length).toBeGreaterThan(0);
    expect(subAgentPayloads.some((p) => p.includes("Risk Factors") || p.includes("net sales"))).toBe(true);
  });
});

describe("graceful degradation", () => {
  it("a failing quote provider yields quote: null, not a failed request", async () => {
    h.failQuote();
    const res = await runAsk(ask(), h.deps);
    expect(res.quote).toBeNull();
    expect(() => AskResponseSchema.parse(res)).not.toThrow();
    // The research half of the pipeline still ran.
    expect(res.subAnswers.length).toBeGreaterThan(0);
    expect(res.summary.headline).toBeTruthy();
  });

  it("a company with no filings still returns a valid response", async () => {
    h.setLatestAccession(null);
    h.setFilings([]);
    const res = await runAsk(ask(), h.deps);
    expect(() => AskResponseSchema.parse(res)).not.toThrow();
    expect(res.filings).toEqual([]);
    expect(res.cache.lastAccession).toBeNull();
  });

  it("rejects an unknown ticker", async () => {
    const req = AskRequestSchema.parse({ ticker: "ZZZZ", question: "What are the risks?" });
    await expect(runAsk(req, h.deps)).rejects.toThrow();
    // Nothing upstream should have been touched.
    expect(h.spies.getLatestAccession).not.toHaveBeenCalled();
    expect(h.spies.embed).not.toHaveBeenCalled();
  });
});

describe("timings", () => {
  it("reports non-negative timings whose parts do not exceed the total", async () => {
    const res = await runAsk(ask(), h.deps);
    const t = res.timings;
    for (const [k, v] of Object.entries(t)) {
      expect(v, `timings.${k}`).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(v), `timings.${k}`).toBe(true);
    }
    // Branches run in parallel, so the max leg (not the sum) bounds the total.
    expect(Math.max(t.quoteMs, t.filingsMs, t.embedMs, t.subAgentsMs, t.synthesisMs))
      .toBeLessThanOrEqual(t.totalMs);
  });
});
