import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ApiErrorSchema,
  AskRequestSchema,
  AskResponseSchema,
  ROUTES,
} from "@finance-demo/contracts";
import { runAsk } from "@api/graph";
import { createApp } from "@api/server";
import { createHarness, researchWorkCounts, type Harness } from "../helpers/harness.js";
import { AAPL_FILINGS, NEWEST_ACCESSION, SUB_ANSWERS } from "../fixtures/index.js";

const ask = (ticker = "aapl", question = "What are the biggest risks?") =>
  AskRequestSchema.parse({ ticker, question });

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

describe("EDGAR failure handling", () => {
  it("surfaces UPSTREAM_SEC_ERROR when EDGAR is down and there is nothing cached", async () => {
    h.failSec();
    // The contract defines UPSTREAM_SEC_ERROR, and a total EDGAR outage with no
    // cached research to fall back on is the one situation that should produce
    // it. Returning a "successful" response here makes an outage
    // indistinguishable from a company that has genuinely never filed, and
    // spends a full round of sub-agent LLM calls to say nothing.
    await expect(runAsk(ask(), h.deps)).rejects.toMatchObject({ code: "UPSTREAM_SEC_ERROR" });
  });

  it("serves the previously cached research when EDGAR is down but research exists", async () => {
    await runAsk(ask(), h.deps);
    const workAfterFirst = researchWorkCounts(h);

    h.failSec();
    const res = await runAsk(ask(), h.deps);

    expect(() => AskResponseSchema.parse(res)).not.toThrow();
    expect(res.cache.filingsReused).toBe(true);
    expect(res.subAnswers.length).toBeGreaterThan(0);
    // Degrading to the cache must not have re-run any research.
    expect(researchWorkCounts(h)).toEqual(workAfterFirst);
    // ...and the quote is still fresh, which is the whole point of the design.
    expect(res.quote).not.toBeNull();
  });

  it("maps a total EDGAR outage to 502 over HTTP, with a contract-valid body", async () => {
    h.failSec();
    const app = createApp(h.deps);
    const res = await app.request(ROUTES.ask, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticker: "AAPL", question: "What are the biggest risks?" }),
    });
    expect(res.status).toBe(502);
    const body = ApiErrorSchema.parse(await res.json());
    expect(body.error.code).toBe("UPSTREAM_SEC_ERROR");
    expect(body.error.message).toBeTruthy();
  });
});

describe("cache integrity", () => {
  it("rebuilds when the cached record has the right accession but no sub-answers", async () => {
    await h.cache.set({
      ticker: "AAPL",
      lastAccession: NEWEST_ACCESSION,
      researchedAt: "2025-01-01T00:00:00.000Z",
      filings: AAPL_FILINGS,
      subAnswers: [],
    });

    const res = await runAsk(ask(), h.deps);
    // A cached record with nothing in it must NOT be served as reused research.
    expect(res.cache.filingsReused).toBe(false);
    expect(res.cache.reason).toBe("cache-miss-rebuilt");
    expect(res.subAnswers.length).toBeGreaterThan(0);
    expect(researchWorkCounts(h).embed).toBeGreaterThan(0);
  });

  it("ignores a corrupt cache file rather than failing the request", async () => {
    await h.cache.set({
      ticker: "AAPL",
      lastAccession: NEWEST_ACCESSION,
      researchedAt: "2025-01-01T00:00:00.000Z",
      filings: AAPL_FILINGS,
      subAnswers: SUB_ANSWERS,
    });
    const { writeFile, readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    for (const f of await readdir(h.cacheDir)) {
      await writeFile(join(h.cacheDir, f), "{ this is not json");
    }
    const res = await runAsk(ask(), h.deps);
    expect(() => AskResponseSchema.parse(res)).not.toThrow();
    expect(res.cache.filingsReused).toBe(false);
    expect(res.subAnswers.length).toBeGreaterThan(0);
  });
});

describe("ticker isolation across requests", () => {
  it("never cites another company's filings", async () => {
    await runAsk(ask("aapl"), h.deps);
    const msft = await runAsk(ask("msft", "What are Microsoft's risks?"), h.deps);

    expect(msft.ticker).toBe("MSFT");
    expect(msft.companyName).toBe("MICROSOFT CORP");
    // Both tickers were served by the same stubbed SEC data, so the guard that
    // matters is the namespace: MSFT vectors must be upserted under "MSFT".
    const namespaces = new Set(h.spies.upsert.mock.calls.map((c) => c[0]));
    expect(namespaces).toEqual(new Set(["AAPL", "MSFT"]));

    // And the two tickers get independent cache records.
    expect((await h.cache.get("AAPL"))?.ticker).toBe("AAPL");
    expect((await h.cache.get("MSFT"))?.ticker).toBe("MSFT");
  });

  it("a second ticker does not mark the first one's research as reused", async () => {
    await runAsk(ask("aapl"), h.deps);
    const msft = await runAsk(ask("msft", "What are Microsoft's risks?"), h.deps);
    expect(msft.cache.filingsReused).toBe(false);
    expect(msft.cache.reason).toBe("cold-start");
  });
});
