/**
 * Formatting helpers. Every field on `Quote` is nullable, so every formatter
 * here takes `number | null | undefined` and returns a real em-dash placeholder
 * rather than "null" / "NaN".
 */

export const EMPTY = "—"; // em dash

const nf = (opts: Intl.NumberFormatOptions) => new Intl.NumberFormat("en-US", opts);

const priceFmt = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactFmt = nf({ notation: "compact", maximumFractionDigits: 2 });
const intFmt = nf({ maximumFractionDigits: 0 });
const ratioFmt = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtPrice(v: number | null | undefined, currency?: string | null): string {
  if (v == null || !Number.isFinite(v)) return EMPTY;
  const sym = currencySymbol(currency);
  return `${sym}${priceFmt.format(v)}`;
}

export function fmtSignedPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return EMPTY;
  return `${v >= 0 ? "+" : "−"}${priceFmt.format(Math.abs(v))}`;
}

export function fmtPercent(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return EMPTY;
  return `${v >= 0 ? "+" : "−"}${priceFmt.format(Math.abs(v))}%`;
}

export function fmtCompact(v: number | null | undefined, currency?: string | null): string {
  if (v == null || !Number.isFinite(v)) return EMPTY;
  return `${currencySymbol(currency)}${compactFmt.format(v)}`;
}

export function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return EMPTY;
  return intFmt.format(v);
}

export function fmtRatio(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return EMPTY;
  return ratioFmt.format(v);
}

export function fmtRange(
  low: number | null | undefined,
  high: number | null | undefined,
  currency?: string | null,
): string {
  if (low == null && high == null) return EMPTY;
  return `${fmtPrice(low, currency)} – ${fmtPrice(high, currency)}`;
}

/** Position of `value` within [low, high], 0..1, or null if not computable. */
export function rangePosition(
  value: number | null | undefined,
  low: number | null | undefined,
  high: number | null | undefined,
): number | null {
  if (value == null || low == null || high == null) return null;
  if (!Number.isFinite(value) || !Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (high <= low) return null;
  return Math.min(1, Math.max(0, (value - low) / (high - low)));
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return EMPTY;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}

export function fmtTimestamp(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "up" | "down" | "flat" — drives the gain/loss colour coding. */
export function direction(v: number | null | undefined): "up" | "down" | "flat" {
  if (v == null || !Number.isFinite(v) || v === 0) return "flat";
  return v > 0 ? "up" : "down";
}

function currencySymbol(currency?: string | null): string {
  const code = (currency ?? "USD").toUpperCase();
  const known: Record<string, string> = {
    USD: "$",
    CAD: "CA$",
    EUR: "\u20ac",
    GBP: "\u00a3",
    JPY: "\u00a5",
    CNY: "CN\u00a5",
    HKD: "HK$",
    AUD: "A$",
    CHF: "CHF ",
    INR: "\u20b9",
    KRW: "\u20a9",
    BRL: "R$",
  };
  return known[code] ?? `${code} `;
}
