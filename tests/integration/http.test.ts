import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ApiErrorSchema,
  AskResponseSchema,
  ROUTES,
  TickerListSchema,
} from "@finance-demo/contracts";
import { createApp } from "@api/server";
import { createHarness, type Harness } from "../helpers/harness.js";
import { BODY_SENTINEL } from "../fixtures/index.js";

let h: Harness;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  h = await createHarness();
  app = createApp(h.deps);
});
afterEach(async () => {
  await h.cleanup();
});

const post = (body: unknown) =>
  app.request(ROUTES.ask, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe(`GET ${ROUTES.health}`, () => {
  it("returns 200 { ok: true }", async () => {
    const res = await app.request(ROUTES.health);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe(`GET ${ROUTES.tickers}`, () => {
  it("returns the contract-valid ticker directory", async () => {
    const res = await app.request(ROUTES.tickers);
    expect(res.status).toBe(200);
    const body = TickerListSchema.parse(await res.json());
    expect(body.length).toBeGreaterThan(10_000);
    expect(body.some((e) => e.t === "AAPL")).toBe(true);
  });

});

describe(`POST ${ROUTES.ask}`, () => {
  it("returns 200 and an AskResponse for a valid request", async () => {
    const res = await post({ ticker: "aapl", question: "What are the biggest risks?" });
    expect(res.status).toBe(200);
    const body = AskResponseSchema.parse(await res.json());
    expect(body.ticker).toBe("AAPL");
    expect(body.companyName).toBe("Apple Inc.");
  });

  it("never leaks raw filing text into the HTTP response outside citations", async () => {
    const res = await post({ ticker: "AAPL", question: "What are the biggest risks?" });
    const body = AskResponseSchema.parse(await res.json());
    // Citations legitimately carry verbatim snippets; the summary must not be a
    // raw text dump, so bound it.
    for (const s of body.summary.sections) expect(s.body.length).toBeLessThan(5000);
    expect(body.summary.narrative.length).toBeLessThan(5000);
    expect(JSON.stringify(body.summary)).not.toContain(BODY_SENTINEL);
  });

  it("returns UNKNOWN_TICKER for a symbol absent from the directory", async () => {
    const res = await post({ ticker: "ZZZZ", question: "What are the biggest risks?" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = ApiErrorSchema.parse(await res.json());
    expect(body.error.code).toBe("UNKNOWN_TICKER");
  });

  it("returns BAD_REQUEST for a malformed body", async () => {
    const cases: unknown[] = [
      { ticker: "AAPL" },                                  // missing question
      { ticker: "AAPL", question: "hi" },                  // question too short
      { ticker: "", question: "What are the risks?" },     // empty ticker
      { ticker: "AAPL", question: "q".repeat(2001) },      // question too long
      { ticker: 42, question: "What are the risks?" },     // wrong type
      {},
    ];
    for (const body of cases) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      const parsed = ApiErrorSchema.parse(await res.json());
      expect(parsed.error.code).toBe("BAD_REQUEST");
    }
  });

  it("returns BAD_REQUEST rather than 500 for a non-JSON body", async () => {
    const res = await app.request(ROUTES.ask, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    expect(res.status).toBe(400);
    expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("still answers when the quote provider is down", async () => {
    h.failQuote();
    const res = await post({ ticker: "AAPL", question: "What are the biggest risks?" });
    expect(res.status).toBe(200);
    expect(AskResponseSchema.parse(await res.json()).quote).toBeNull();
  });

  it("error responses never contain secrets", async () => {
    const res = await post({ ticker: "ZZZZ", question: "What are the biggest risks?" });
    const text = await res.text();
    for (const needle of ["ANTHROPIC_API_KEY", "PINECONE_API_KEY", "sk-ant-", "pcsk_"]) {
      expect(text).not.toContain(needle);
    }
  });
});

describe("unknown routes", () => {
  it("404s an unknown path", async () => {
    expect((await app.request("/api/nope")).status).toBe(404);
  });
});
