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
 */
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
  for (let start = 0; start < text.length; start += size) {
    const slice = text.slice(start, start + size);
    chunks.push(start === 0 ? slice : text.slice(start - overlap, start) + slice);
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
