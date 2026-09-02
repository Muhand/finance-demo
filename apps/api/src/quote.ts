import YahooFinance from "yahoo-finance2";

import { QuoteSchema, type Quote } from "@finance-demo/contracts";

import { warn } from "./log.ts";

type YahooClient = InstanceType<typeof YahooFinance>;

let client: YahooClient | null = null;

function getClient(): YahooClient {
  if (!client) {
    client = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  }
  return client;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toIso(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    // Yahoo has historically sent seconds; tolerate both.
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

/**
 * Real-time quote. Resolves `null` on any upstream failure: a missing quote
 * must never fail the request (see docs/ARCHITECTURE.md, node contracts).
 */
export async function fetchQuote(ticker: string): Promise<Quote | null> {
  const symbol = String(ticker ?? "").trim().toUpperCase();
  if (!symbol) return null;

  try {
    const raw = (await getClient().quote(symbol)) as Record<string, unknown> | undefined;
    if (!raw) return null;

    return QuoteSchema.parse({
      symbol: str(raw.symbol) ?? symbol,
      name: str(raw.longName) ?? str(raw.shortName),
      price: num(raw.regularMarketPrice),
      change: num(raw.regularMarketChange),
      // Already a percent value; do not multiply by 100.
      changePercent: num(raw.regularMarketChangePercent),
      currency: str(raw.currency),
      marketCap: num(raw.marketCap),
      dayHigh: num(raw.regularMarketDayHigh),
      dayLow: num(raw.regularMarketDayLow),
      volume: num(raw.regularMarketVolume),
      fiftyTwoWeekHigh: num(raw.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: num(raw.fiftyTwoWeekLow),
      peRatio: num(raw.trailingPE),
      asOf: toIso(raw.regularMarketTime),
    });
  } catch (err) {
    warn(`fetchQuote(${symbol}) failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
