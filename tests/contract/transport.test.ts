import { describe, expect, it } from "vitest";
import {
  ApiErrorSchema,
  AskResponseSchema,
  CHUNKING,
  ROUTES,
} from "@finance-demo/contracts";
import { ASK_RESPONSE, ASK_RESPONSE_REUSED, INTERNAL_ERROR } from "../fixtures/index.js";

describe("wire transport", () => {
  it("AskResponse survives a JSON round-trip unchanged", () => {
    // Catches Date objects, undefined, NaN and Infinity leaking into the
    // payload — all of which parse locally but change or vanish over HTTP.
    for (const res of [ASK_RESPONSE, ASK_RESPONSE_REUSED]) {
      const wire = JSON.parse(JSON.stringify(res));
      expect(AskResponseSchema.parse(wire)).toEqual(res);
    }
  });

  it("ApiError survives a JSON round-trip, null detail included", () => {
    const wire = JSON.parse(JSON.stringify(INTERNAL_ERROR));
    expect(ApiErrorSchema.parse(wire)).toEqual(INTERNAL_ERROR);
    expect(wire.error.detail).toBeNull();
  });

  it("rejects a non-finite number that JSON would silently turn into null", () => {
    const broken = { ...ASK_RESPONSE, timings: { ...ASK_RESPONSE.timings, totalMs: Number.NaN } };
    const wire = JSON.parse(JSON.stringify(broken));
    expect(wire.timings.totalMs).toBeNull();
    expect(AskResponseSchema.safeParse(wire).success).toBe(false);
  });
});

describe("shared constants", () => {
  it("pins the route paths the frontend and backend both hard-code", () => {
    expect(ROUTES).toEqual({
      tickers: "/api/tickers",
      ask: "/api/questions",
      health: "/api/health",
    });
  });

  it("pins the chunking parameters, with overlap strictly smaller than size", () => {
    expect(CHUNKING.size).toBe(1800);
    expect(CHUNKING.overlap).toBe(200);
    expect(CHUNKING.overlap).toBeLessThan(CHUNKING.size);
  });
});
