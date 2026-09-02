import { describe, expect, it } from "vitest";
import { HashEmbedder, createEmbedder } from "@api/embeddings";
import { MDA_TEXT, RISK_FACTORS_TEXT } from "../fixtures/index.js";

const norm = (v: number[]) => Math.sqrt(v.reduce((a, x) => a + x * x, 0));
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

describe("HashEmbedder", () => {
  const embedder = new HashEmbedder();

  it("exposes the 384-dim MiniLM-compatible dimension", () => {
    // Must match LocalEmbedder so the offline fake is a drop-in for Pinecone.
    expect(embedder.dim).toBe(384);
  });

  it("returns one dim-length vector per input, in input order", async () => {
    const texts = ["alpha", "beta", "gamma"];
    const vectors = await embedder.embed(texts);
    expect(vectors).toHaveLength(3);
    for (const v of vectors) expect(v).toHaveLength(embedder.dim);
    // Order-preserving: embedding each alone must equal its slot in the batch.
    for (let i = 0; i < texts.length; i++) {
      expect((await embedder.embed([texts[i]!]))[0]).toEqual(vectors[i]);
    }
  });

  it("is deterministic — the same input yields a bit-identical vector", async () => {
    const [a] = await embedder.embed([RISK_FACTORS_TEXT]);
    const [b] = await embedder.embed([RISK_FACTORS_TEXT]);
    expect(a).toEqual(b);
    // ...and across instances, so a restart cannot invalidate the vector store.
    const [c] = await new HashEmbedder().embed([RISK_FACTORS_TEXT]);
    expect(c).toEqual(a);
  });

  it("returns L2-normalized vectors", async () => {
    const vectors = await embedder.embed([RISK_FACTORS_TEXT, MDA_TEXT, "short", "a"]);
    for (const v of vectors) expect(norm(v)).toBeCloseTo(1, 6);
  });

  it("produces only finite numbers", async () => {
    const vectors = await embedder.embed([RISK_FACTORS_TEXT, "x", "  "]);
    for (const v of vectors) expect(v.every(Number.isFinite)).toBe(true);
  });

  it("distinguishes different texts", async () => {
    const [a, b] = await embedder.embed(["revenue grew twelve percent", "the cat sat on the mat"]);
    expect(a).not.toEqual(b);
    // Normalized vectors: cosine == dot. Unrelated texts must not be near-identical.
    expect(dot(a!, b!)).toBeLessThan(0.99);
  });

  it("handles an empty batch and empty strings without throwing", async () => {
    expect(await embedder.embed([])).toEqual([]);
    const vectors = await embedder.embed(["", "   "]);
    expect(vectors).toHaveLength(2);
    for (const v of vectors) expect(v).toHaveLength(embedder.dim);
  });

  it("handles a large batch of long documents", async () => {
    const batch = Array.from({ length: 40 }, (_, i) => `${RISK_FACTORS_TEXT}\n#${i}`);
    const vectors = await embedder.embed(batch);
    expect(vectors).toHaveLength(40);
    expect(new Set(vectors.map((v) => v.join(","))).size).toBe(40);
  });
});

describe("createEmbedder", () => {
  it("returns a 384-dim Embedder with no credentials in the environment", () => {
    const embedder = createEmbedder({} as NodeJS.ProcessEnv);
    expect(embedder.dim).toBe(384);
    expect(typeof embedder.embed).toBe("function");
  });
});
