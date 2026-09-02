import type { Quote } from "@finance-demo/contracts";

/** A realistic, fully-populated yahoo-finance2-shaped quote. */
export const AAPL_QUOTE: Quote = {
  symbol: "AAPL",
  name: "Apple Inc.",
  price: 228.52,
  change: -1.36,
  changePercent: -0.5916,
  currency: "USD",
  marketCap: 3_456_000_000_000,
  dayHigh: 230.16,
  dayLow: 227.34,
  volume: 41_872_300,
  fiftyTwoWeekHigh: 260.1,
  fiftyTwoWeekLow: 164.08,
  peRatio: 34.71,
  asOf: "2025-01-15T21:00:00.000Z",
};

/**
 * A sparse quote: every optional numeric is null. Real quotes for thinly traded
 * or non-US listings look like this, so the UI and schema must tolerate it.
 */
export const SPARSE_QUOTE: Quote = {
  symbol: "AAPL",
  name: null,
  price: null,
  change: null,
  changePercent: null,
  currency: null,
  marketCap: null,
  dayHigh: null,
  dayLow: null,
  volume: null,
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
  peRatio: null,
  asOf: "2025-01-15T21:00:00.000Z",
};

/** Build a distinguishable quote per call, so "was the quote refetched?" is testable. */
export function makeQuote(seq: number): Quote {
  return { ...AAPL_QUOTE, price: 200 + seq, asOf: `2025-01-15T21:00:0${seq}.000Z` };
}
