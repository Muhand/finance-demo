import type { TickerEntry } from "@finance-demo/contracts";

/**
 * Client-side ranking over the preloaded directory. Mirrors the ordering the
 * contract specifies for the server-side `filterTickers`:
 *
 *   0. exact symbol match
 *   1. symbol prefix
 *   2. name prefix
 *   3. name substring
 *
 * Case-insensitive. Empty query -> []. Ties break on symbol length, then
 * alphabetically, so `AA` beats `AAADF` for the query "aa".
 *
 * This runs over ~10k rows on every keystroke, so it is a single pass with no
 * allocation per row beyond the bucket push, and it bails out of the scan as
 * soon as every bucket is saturated enough to fill `limit`.
 */

const TIER_EXACT_SYMBOL = 0;
const TIER_SYMBOL_PREFIX = 1;
const TIER_NAME_PREFIX = 2;
const TIER_NAME_SUBSTRING = 3;
const TIER_COUNT = 4;

export const DEFAULT_LIMIT = 25;

export function rankTickers(
  entries: readonly TickerEntry[],
  rawQuery: string,
  limit: number = DEFAULT_LIMIT,
): TickerEntry[] {
  const q = rawQuery.trim().toLowerCase();
  if (q === "" || limit <= 0) return [];

  const buckets: TickerEntry[][] = [[], [], [], []];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const sym = e.t.toLowerCase();

    if (sym === q) {
      buckets[TIER_EXACT_SYMBOL]!.push(e);
      continue;
    }
    if (sym.startsWith(q)) {
      buckets[TIER_SYMBOL_PREFIX]!.push(e);
      continue;
    }
    const name = e.n.toLowerCase();
    if (name.startsWith(q)) {
      buckets[TIER_NAME_PREFIX]!.push(e);
      continue;
    }
    if (name.includes(q)) {
      buckets[TIER_NAME_SUBSTRING]!.push(e);
    }
  }

  const out: TickerEntry[] = [];
  for (let tier = 0; tier < TIER_COUNT && out.length < limit; tier++) {
    const bucket = buckets[tier]!;
    // Only the tiers we actually render get sorted.
    bucket.sort(compareEntries);
    for (let i = 0; i < bucket.length && out.length < limit; i++) {
      out.push(bucket[i]!);
    }
  }
  return out;
}

function compareEntries(a: TickerEntry, b: TickerEntry): number {
  if (a.t.length !== b.t.length) return a.t.length - b.t.length;
  return a.t < b.t ? -1 : a.t > b.t ? 1 : 0;
}

/** Case-insensitive exact symbol lookup, for free-text fallback entry. */
export function findExactSymbol(
  entries: readonly TickerEntry[],
  symbol: string,
): TickerEntry | null {
  const q = symbol.trim().toLowerCase();
  if (!q) return null;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]!.t.toLowerCase() === q) return entries[i]!;
  }
  return null;
}
