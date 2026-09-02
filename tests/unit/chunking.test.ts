import { describe, expect, it } from "vitest";
import { CHUNKING, ChunkSchema } from "@finance-demo/contracts";
import { chunkFiling, chunkText } from "@api/chunking";
import {
  AAPL_10K_SECTIONS,
  AAPL_FILINGS,
  MDA_TEXT,
  RISK_FACTORS_TEXT,
  SECTIONS_WITH_EMPTY,
} from "../fixtures/index.js";

/**
 * Spec (docs/MODULE_MAP.md + CHUNKING in the contract):
 *   slices     = [text[0..size), text[size..2size), ...]
 *   chunks[0]  = slices[0]
 *   chunks[i]  = slices[i-1].slice(-overlap) + slices[i]      for i > 0
 */
function expectedChunks(text: string, size: number, overlap: number): string[] {
  if (text.trim().length === 0) return [];
  const slices: string[] = [];
  for (let i = 0; i < text.length; i += size) slices.push(text.slice(i, i + size));
  return slices.map((s, i) => (i === 0 ? s : slices[i - 1]!.slice(-overlap) + s));
}

/** Strip the overlap prefix back off and re-join — must reproduce the input exactly. */
function reconstruct(chunks: string[], overlap: number): string {
  if (chunks.length === 0) return "";
  return chunks[0]! + chunks.slice(1).map((c) => c.slice(overlap)).join("");
}

const SIZE = 100;
const OVERLAP = 20;
const opts = { size: SIZE, overlap: OVERLAP };

describe("chunkText — empty and short input", () => {
  it("returns [] for empty and whitespace-only input", () => {
    for (const text of ["", "   ", "\n\n\t ", " "]) {
      expect(chunkText(text, opts)).toEqual([]);
    }
  });

  it("returns the text unmodified as a single chunk when shorter than size", () => {
    const text = "Item 1A. Risk Factors are summarised here.";
    expect(text.length).toBeLessThan(SIZE);
    expect(chunkText(text, opts)).toEqual([text]);
  });

  it("returns one chunk when the text is exactly `size` characters", () => {
    const text = "x".repeat(SIZE);
    expect(chunkText(text, opts)).toEqual([text]);
  });

  it("splits into two chunks at size + 1 characters", () => {
    const text = "x".repeat(SIZE) + "y";
    const chunks = chunkText(text, opts);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe("x".repeat(SIZE));
    expect(chunks[1]).toBe("x".repeat(OVERLAP) + "y");
  });
});

describe("chunkText — overlap semantics", () => {
  // A text where every character position is identifiable, so an off-by-one in
  // the overlap window is impossible to hide.
  const text = Array.from({ length: 520 }, (_, i) => String.fromCharCode(33 + (i % 90))).join("");

  it("matches the spec's exact slice/prefix construction", () => {
    expect(chunkText(text, opts)).toEqual(expectedChunks(text, SIZE, OVERLAP));
  });

  it("consecutive chunks genuinely share the overlap window, character for character", () => {
    const chunks = chunkText(text, opts);
    expect(chunks.length).toBeGreaterThan(3);
    for (let i = 1; i < chunks.length; i++) {
      const prevTail = chunks[i - 1]!.slice(-OVERLAP);
      expect(chunks[i]!.slice(0, OVERLAP)).toBe(prevTail);
    }
  });

  it("drops no content — removing the overlaps reconstructs the original exactly", () => {
    for (const t of [text, RISK_FACTORS_TEXT, MDA_TEXT, "a".repeat(SIZE * 4)]) {
      expect(reconstruct(chunkText(t, opts), OVERLAP)).toBe(t);
    }
  });

  it("handles exact-multiple boundaries without emitting a trailing empty chunk", () => {
    for (const multiple of [2, 3, 5]) {
      const t = "z".repeat(SIZE * multiple);
      const chunks = chunkText(t, opts);
      expect(chunks).toHaveLength(multiple);
      expect(chunks.every((c) => c.length > 0)).toBe(true);
      expect(reconstruct(chunks, OVERLAP)).toBe(t);
    }
  });

  it("chunk sizes obey the contract: first is `size`, the rest are at most size + overlap", () => {
    const chunks = chunkText(text, opts);
    expect(chunks[0]).toHaveLength(SIZE);
    for (const c of chunks.slice(1)) expect(c.length).toBeLessThanOrEqual(SIZE + OVERLAP);
  });
});

describe("chunkText — defaults and invalid options", () => {
  it("defaults to the CHUNKING constants from the frozen contract", () => {
    const text = "q".repeat(CHUNKING.size * 2 + 37);
    expect(chunkText(text)).toEqual(expectedChunks(text, CHUNKING.size, CHUNKING.overlap));
  });

  it("rejects overlap >= size", () => {
    expect(() => chunkText("abcdef", { size: 10, overlap: 10 })).toThrow();
    expect(() => chunkText("abcdef", { size: 10, overlap: 11 })).toThrow();
  });

  it("accepts overlap === 0 (no overlap, pure slicing)", () => {
    const t = "abcdefghij";
    expect(chunkText(t, { size: 4, overlap: 0 })).toEqual(["abcd", "efgh", "ij"]);
  });
});

describe("chunkText — unicode safety", () => {
  // BMP-only multi-byte text: 3 bytes in UTF-8, but one UTF-16 code unit each,
  // so the literal "size-char slice" spec is unambiguous here.
  const bmpText = ("研究開発費は前年同期比で増加した。café naïve — Ünternehmen ").repeat(30);
  // Astral-plane characters occupy TWO UTF-16 code units each.
  const astralText = ("📈📉💹🧾🏦 quarterly results 🚀").repeat(40);

  it("never loses or corrupts content on multi-byte (BMP) text", () => {
    const chunks = chunkText(bmpText, opts);
    expect(chunks.length).toBeGreaterThan(1);
    expect(reconstruct(chunks, OVERLAP)).toBe(bmpText);
  });

  it("every chunk survives a UTF-8 round-trip — no chunk boundary corrupts a character", () => {
    // A boundary that lands inside a surrogate pair leaves a lone surrogate,
    // which becomes U+FFFD the moment the chunk is UTF-8 encoded (HTTP body,
    // embedding request, on-disk cache). That is silent data corruption.
    const chunks = chunkText(astralText, opts);
    expect(chunks.length).toBeGreaterThan(1);
    const corrupted = chunks
      .map((c, i) => ({ i, ok: Buffer.from(c, "utf8").toString("utf8") === c }))
      .filter((r) => !r.ok)
      .map((r) => r.i);
    expect(corrupted).toEqual([]);
  });
});

describe("chunkFiling", () => {
  const filing = AAPL_FILINGS[0]!;
  const ticker = "AAPL";

  it("produces contract-valid Chunks that carry the filing's metadata", () => {
    const chunks = chunkFiling(filing, ticker, AAPL_10K_SECTIONS, opts);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      ChunkSchema.parse(c);
      expect(c.ticker).toBe(ticker);
      expect(c.accessionNumber).toBe(filing.accessionNumber);
      expect(c.formType).toBe(filing.formType);
      expect(c.filingDate).toBe(filing.filingDate);
      expect(c.url).toBe(filing.url);
    }
  });

  it("gives every chunk a unique id", () => {
    const chunks = chunkFiling(filing, ticker, AAPL_10K_SECTIONS, opts);
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
  });

  it("preserves section labels and assigns strictly increasing chunk indices in document order", () => {
    const chunks = chunkFiling(filing, ticker, AAPL_10K_SECTIONS, opts);
    expect(chunks.map((c) => c.section)).toContain("1A");
    expect(chunks.map((c) => c.section)).toContain("7");
    for (const section of ["1A", "7"]) {
      const forSection = chunks.filter((c) => c.section === section);
      expect(forSection.length).toBeGreaterThan(1);
      const idx = forSection.map((c) => c.chunkIndex);
      expect(idx.every((n) => Number.isInteger(n) && n >= 0)).toBe(true);
      expect(new Set(idx).size).toBe(idx.length);
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
    }
  });

  it("covers each section's full text — the section is reconstructible from its chunks", () => {
    const chunks = chunkFiling(filing, ticker, AAPL_10K_SECTIONS, opts);
    for (const { section, text } of AAPL_10K_SECTIONS) {
      const texts = chunks.filter((c) => c.section === section).map((c) => c.text);
      expect(reconstruct(texts, OVERLAP)).toBe(text);
    }
  });

  it("skips whitespace-only sections and keeps null-section text", () => {
    const chunks = chunkFiling(filing, ticker, SECTIONS_WITH_EMPTY, opts);
    expect(chunks.some((c) => c.section === "9B")).toBe(false);
    expect(chunks.some((c) => c.section === null)).toBe(true);
  });

  it("returns [] when there are no sections", () => {
    expect(chunkFiling(filing, ticker, [], opts)).toEqual([]);
  });
});
