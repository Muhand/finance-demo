import { describe, expect, it } from "vitest";
import { TickerEntrySchema } from "@finance-demo/contracts";
import { filterTickers, loadTickerDirectory, resolveTicker } from "@api/tickers";

/** Rank tier per docs/MODULE_MAP.md: exact symbol < symbol prefix < name prefix < name substring. */
function tier(entry: { t: string; n: string }, upperQuery: string): number {
  if (entry.t === upperQuery) return 0;
  if (entry.t.startsWith(upperQuery)) return 1;
  const n = entry.n.toUpperCase();
  if (n.startsWith(upperQuery)) return 2;
  if (n.includes(upperQuery)) return 3;
  return 9;
}

describe("loadTickerDirectory", () => {
  it("loads the full directory of contract-valid entries", () => {
    const dir = loadTickerDirectory();
    expect(dir.length).toBeGreaterThan(10_000);
    TickerEntrySchema.parse(dir[0]);
  });

  it("is memoized — repeat calls return the identical array instance", () => {
    expect(loadTickerDirectory()).toBe(loadTickerDirectory());
  });
});

describe("resolveTicker", () => {
  it("resolves a known symbol to its CIK and name", () => {
    expect(resolveTicker("AAPL")).toEqual({ t: "AAPL", n: "Apple Inc.", c: "0000320193" });
  });

  it("is case-insensitive", () => {
    const canonical = resolveTicker("AAPL");
    for (const variant of ["aapl", "AaPl", "aApL"]) {
      expect(resolveTicker(variant)).toEqual(canonical);
    }
  });

  it("resolves single-letter and hyphenated symbols", () => {
    expect(resolveTicker("v")?.t).toBe("V");
    expect(resolveTicker("brk-b")?.t).toBe("BRK-B");
  });

  it("returns null for unknown symbols and for empty input", () => {
    for (const q of ["ZZZZ", "NOTATICKER", "", "  "]) {
      expect(resolveTicker(q)).toBeNull();
    }
  });

  it("is exact, not a prefix match", () => {
    // "AAP" is itself a real ticker; "AAPLX" is not and must not fall back to AAPL.
    expect(resolveTicker("AAP")?.n).toBe("ADVANCE AUTO PARTS INC");
    expect(resolveTicker("AAPLX")).toBeNull();
  });
});

describe("filterTickers", () => {
  it("returns [] for an empty or whitespace-only query", () => {
    for (const q of ["", "   ", "\t"]) expect(filterTickers(q)).toEqual([]);
  });

  it("puts the exact symbol match first", () => {
    expect(filterTickers("AAP")[0]?.t).toBe("AAP");
    expect(filterTickers("V")[0]?.t).toBe("V");
    expect(filterTickers("c")[0]?.t).toBe("C");
  });

  it("orders results by the specified rank tiers, never out of order", () => {
    // "V" is an exact symbol, a symbol prefix for ~254, a name prefix for ~48
    // and a name substring for ~1461 — all four tiers in one query.
    const results = filterTickers("V", 2000);
    const tiers = results.map((e) => tier(e, "V"));
    expect(tiers.length).toBeGreaterThan(100);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    expect(tiers).not.toContain(9); // every result actually matches the query
  });

  it("ranks a symbol-prefix hit above a name-only hit", () => {
    const results = filterTickers("MICRO", 200);
    const symbolPrefix = results.findIndex((e) => e.t.startsWith("MICRO"));
    const nameOnly = results.findIndex((e) => !e.t.startsWith("MICRO"));
    if (symbolPrefix !== -1 && nameOnly !== -1) expect(symbolPrefix).toBeLessThan(nameOnly);
    // MSFT matches only by name substring ("MICROSOFT CORP") and must still be found.
    expect(results.some((e) => e.t === "MSFT")).toBe(true);
  });

  it("matches on company name as well as symbol", () => {
    expect(filterTickers("NVIDIA")[0]?.t).toBe("NVDA");
    expect(filterTickers("apple", 10).some((e) => e.t === "AAPL")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(filterTickers("nvidia", 5)).toEqual(filterTickers("NVIDIA", 5));
    expect(filterTickers("aapl", 5)).toEqual(filterTickers("AAPL", 5));
  });

  it("honours the limit and defaults to 25", () => {
    expect(filterTickers("A", 5)).toHaveLength(5);
    expect(filterTickers("A", 1)).toHaveLength(1);
    expect(filterTickers("A")).toHaveLength(25);
    expect(filterTickers("A", 0)).toEqual([]);
  });

  it("returns [] when nothing matches", () => {
    expect(filterTickers("QQQZZZXXYY")).toEqual([]);
  });
});
