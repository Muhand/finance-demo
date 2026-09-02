import { CHUNKING, type Chunk, type FilingRef } from "@finance-demo/contracts";

export interface ChunkOptions {
  size?: number;
  overlap?: number;
}

/**
 * Overlap chunking, exactly as specified by `CHUNKING` in the contract:
 *
 *   - slice `text` into `size`-character pieces;
 *   - every piece after the first is prefixed with the previous piece's
 *     trailing `overlap` characters.
 *
 * Consequences relied on downstream (and by QA):
 *   - `chunks[i].startsWith(chunks[i - 1].slice(-overlap))`
 *   - `chunks[0] + chunks.slice(1).map(c => c.slice(overlap)).join("")` === text
 *   - no chunk boundary ever splits a surrogate pair (see `safeBoundary`)
 */
const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/**
 * Nudge a cut index forward off the seam between a surrogate pair.
 *
 * `CHUNKING` counts UTF-16 code units, but an astral character (an emoji, and
 * plenty of symbols that appear in filings) occupies two of them. A cut landing
 * between the two halves leaves a lone surrogate, which silently becomes U+FFFD
 * the moment the chunk is UTF-8 encoded for an HTTP body, an embedding request
 * or the on-disk cache — so the text we embed, and the snippet we cite back to
 * the user, would not be what the company actually filed.
 *
 * For BMP text this is the identity function, so every other chunking invariant
 * (exact slice construction, overlap continuity, lossless reconstruction) is
 * bit-for-bit unchanged.
 */
function safeBoundary(text: string, i: number): number {
  if (i <= 0 || i >= text.length) return i;
  return isHighSurrogate(text.charCodeAt(i - 1)) && isLowSurrogate(text.charCodeAt(i)) ? i + 1 : i;
}

export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const size = opts.size ?? CHUNKING.size;
  const overlap = opts.overlap ?? CHUNKING.overlap;

  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError(`chunkText: size must be a positive number, got ${size}`);
  }
  if (!Number.isFinite(overlap) || overlap < 0) {
    throw new RangeError(`chunkText: overlap must be a non-negative number, got ${overlap}`);
  }
  if (overlap >= size) {
    throw new RangeError(`chunkText: overlap (${overlap}) must be < size (${size})`);
  }

  if (typeof text !== "string" || text.trim().length === 0) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = safeBoundary(text, Math.min(start + size, text.length));
    const body = text.slice(start, end);
    // Absolute indices rather than a negative slice, so overlap === 0 yields ""
    // instead of tripping the `String.prototype.slice(-0)` trap.
    chunks.push(start === 0 ? body : text.slice(safeBoundary(text, start - overlap), start) + body);
    start = end;
  }
  return chunks;
}

/**
 * Chunk every extracted section of one filing into embeddable `Chunk`s.
 * `chunkIndex` runs monotonically across the whole filing so it is unique
 * within an (accessionNumber, ticker) pair.
 */
export function chunkFiling(
  filing: FilingRef,
  ticker: string,
  sections: Array<{ section: string | null; text: string }>,
  opts: ChunkOptions = {},
): Chunk[] {
  const symbol = ticker.toUpperCase();
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const label = section.section ?? null;
    for (const text of chunkText(section.text ?? "", opts)) {
      chunks.push({
        id: `${symbol}:${filing.accessionNumber}:${label ?? "doc"}:${chunkIndex}`,
        ticker: symbol,
        accessionNumber: filing.accessionNumber,
        formType: filing.formType,
        filingDate: filing.filingDate,
        section: label,
        chunkIndex,
        text,
        url: filing.url,
      });
      chunkIndex += 1;
    }
  }

  return chunks;
}
