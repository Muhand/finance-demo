import { describe, expect, it } from "vitest";
import { TickerListSchema } from "@finance-demo/contracts";
import directory from "@finance-demo/contracts/tickers.json" with { type: "json" };

const entries = TickerListSchema.parse(directory);
const bySymbol = new Map(entries.map((e) => [e.t, e]));

describe("shipped ticker directory", () => {
  it("parses as TickerListSchema and is the full SEC directory", () => {
    expect(entries.length).toBeGreaterThan(10_000);
  });

  it("contains the known bellwether tickers with correct 10-digit CIKs", () => {
    expect(bySymbol.get("AAPL")).toEqual({ t: "AAPL", n: "Apple Inc.", c: "0000320193" });
    expect(bySymbol.get("NVDA")).toMatchObject({ t: "NVDA", c: "0001045810" });
    expect(bySymbol.get("MSFT")).toMatchObject({ t: "MSFT", c: "0000789019" });
  });

  it("every CIK is exactly 10 digits, zero-padded", () => {
    const bad = entries.filter((e) => !/^\d{10}$/.test(e.c));
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("every symbol is uppercase and non-empty", () => {
    const bad = entries.filter((e) => e.t.length === 0 || e.t !== e.t.toUpperCase());
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("symbols are unique — a duplicate would make resolveTicker ambiguous", () => {
    expect(bySymbol.size).toBe(entries.length);
  });

  it("every company name is non-empty", () => {
    const bad = entries.filter((e) => e.n.trim().length === 0);
    expect(bad.slice(0, 5)).toEqual([]);
  });
});
