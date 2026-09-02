import { readFileSync } from "node:fs";

import { TickerListSchema, type TickerEntry } from "@finance-demo/contracts";
// Statically imported so bundlers can resolve the directory at build time.
// A dynamic readFileSync here makes Turbopack trace the entire project into the
// serverless function, which fails the Next build.
import bundledTickers from "@finance-demo/contracts/tickers.json";

let directory: TickerEntry[] | null = null;
let bySymbol: Map<string, TickerEntry> | null = null;

/** Loads (and memoizes) the preloaded SEC ticker directory. */
export function loadTickerDirectory(): TickerEntry[] {
  if (directory) return directory;
  const override = process.env.TICKERS_PATH?.trim();
  const source: unknown = override
    ? JSON.parse(readFileSync(/* turbopackIgnore: true */ override, "utf8"))
    : bundledTickers;
  directory = TickerListSchema.parse(source);
  bySymbol = new Map(directory.map((entry) => [entry.t.toUpperCase(), entry]));
  return directory;
}

/** Exact, case-insensitive symbol lookup. */
export function resolveTicker(symbol: string): TickerEntry | null {
  loadTickerDirectory();
  const key = String(symbol ?? "").trim().toUpperCase();
  if (!key) return null;
  return bySymbol?.get(key) ?? null;
}

/**
 * Ranked search: exact symbol, then symbol prefix, then name prefix, then name
 * substring. Ties keep directory order (which is roughly market-cap ranked).
 */
export function filterTickers(query: string, limit = 25): TickerEntry[] {
  const q = String(query ?? "").trim().toUpperCase();
  if (!q) return [];
  const max = Math.max(0, Math.floor(limit));
  if (max === 0) return [];

  const scored: Array<{ entry: TickerEntry; rank: number }> = [];
  for (const entry of loadTickerDirectory()) {
    const symbol = entry.t.toUpperCase();
    const name = entry.n.toUpperCase();
    let rank = -1;
    if (symbol === q) rank = 0;
    else if (symbol.startsWith(q)) rank = 1;
    else if (name.startsWith(q)) rank = 2;
    else if (name.includes(q)) rank = 3;
    if (rank >= 0) scored.push({ entry, rank });
  }

  // Array#sort is stable, so equal ranks retain directory order.
  scored.sort((a, b) => a.rank - b.rank);
  return scored.slice(0, max).map((s) => s.entry);
}

/** Test seam: drop the memoized directory (e.g. after changing TICKERS_PATH). */
export function resetTickerDirectory(): void {
  directory = null;
  bySymbol = null;
}
