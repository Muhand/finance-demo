import type { Quote } from "@finance-demo/contracts";
import {
  direction,
  fmtCompact,
  fmtInt,
  fmtPercent,
  fmtPrice,
  fmtRange,
  fmtRatio,
  fmtSignedPrice,
  fmtTimestamp,
  rangePosition,
} from "@/lib/format";
import { AlertIcon } from "./icons";
import s from "./ui.module.css";

/**
 * The live quote. Every numeric field on the contract's `Quote` is nullable,
 * so nothing here assumes a value exists — missing fields render as an em dash
 * and the gain/loss colouring falls back to neutral.
 */
export function QuoteCard({ quote, ticker }: { quote: Quote | null; ticker: string }) {
  if (!quote) {
    return (
      <div className={s.quoteMissing} role="note">
        <strong>{ticker}</strong> — no live quote came back with this answer. The
        market-data provider was unavailable, so the research below is based on
        filings alone.
      </div>
    );
  }

  const dir = direction(quote.changePercent ?? quote.change);
  const dirClass = dir === "up" ? s.up : dir === "down" ? s.down : s.flat;
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "—";

  const dayPos = rangePosition(quote.price, quote.dayLow, quote.dayHigh);
  const yearPos = rangePosition(quote.price, quote.fiftyTwoWeekLow, quote.fiftyTwoWeekHigh);

  return (
    <section className={s.quoteCard} aria-label={`Live quote for ${quote.symbol}`}>
      <div className={s.quoteTop}>
        <div className={s.quoteIdent}>
          <span className={s.quoteSymbol}>{quote.symbol}</span>
          {quote.name ? (
            <span className={s.quoteName} title={quote.name}>
              {quote.name}
            </span>
          ) : null}
        </div>
        <div className={s.quotePriceBlock}>
          <span className={`${s.quotePrice} ${dirClass}`}>
            {fmtPrice(quote.price, quote.currency)}
          </span>
          <span className={`${s.quoteDelta} ${dirClass}`}>
            <span aria-hidden="true">{arrow}</span>
            <span>{fmtSignedPrice(quote.change)}</span>
            <span>({fmtPercent(quote.changePercent)})</span>
          </span>
        </div>
      </div>

      <div className={s.statGrid}>
        <Stat label="Market cap" value={fmtCompact(quote.marketCap, quote.currency)} />
        <Stat label="P/E" value={fmtRatio(quote.peRatio)} />
        <Stat label="Volume" value={fmtInt(quote.volume)} />
        <Stat
          label="Day range"
          value={fmtRange(quote.dayLow, quote.dayHigh, quote.currency)}
          position={dayPos}
        />
        <Stat
          label="52-week range"
          value={fmtRange(quote.fiftyTwoWeekLow, quote.fiftyTwoWeekHigh, quote.currency)}
          position={yearPos}
        />
        <Stat label="Currency" value={quote.currency ?? "—"} />
      </div>

      <div className={s.quoteFoot}>
        <span className={s.badge}>Live</span>
        <span>Quote as of {fmtTimestamp(quote.asOf)}</span>
        {quote.price == null ? (
          <span className={s.ungrounded}>
            <AlertIcon size={12} /> price unavailable
          </span>
        ) : null}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  position,
}: {
  label: string;
  value: string;
  position?: number | null;
}) {
  return (
    <div className={s.stat}>
      <span className={s.statLabel}>{label}</span>
      <span className={`${s.statValue} num`} title={value}>
        {value}
      </span>
      {position != null ? (
        <div className={s.rangeTrack} aria-hidden="true">
          <span className={s.rangeMarker} style={{ left: `${position * 100}%` }} />
        </div>
      ) : null}
    </div>
  );
}
