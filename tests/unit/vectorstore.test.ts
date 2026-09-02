import { beforeEach, describe, expect, it } from "vitest";
import type { Chunk } from "@finance-demo/contracts";
import { MemoryVectorStore } from "@api/vectorstore";
import { CHUNK } from "../fixtures/index.js";

function chunk(id: string, overrides: Partial<Chunk> = {}): Chunk {
  return { ...CHUNK, id, ...overrides };
}

/** Hand-built vectors with known cosine similarity to [1,0,0]: 1.0, 0.6, 0.0, -1.0. */
const A = chunk("a");
const B = chunk("b");
const C = chunk("c");
const D = chunk("d");
const VECTORS = [
  [1, 0, 0],
  [0.6, 0.8, 0],
  [0, 1, 0],
  [-1, 0, 0],
];
const QUERY = [1, 0, 0];

describe("MemoryVectorStore", () => {
  let store: MemoryVectorStore;
  beforeEach(() => {
    store = new MemoryVectorStore();
  });

  it("round-trips upsert -> query and returns the stored chunk objects", async () => {
    await store.upsert("AAPL", [A], [[1, 0, 0]]);
    const matches = await store.query("AAPL", QUERY, 5);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.chunk).toEqual(A);
    expect(matches[0]!.score).toBeCloseTo(1, 6);
  });

  it("ranks matches by descending cosine similarity with correct scores", async () => {
    await store.upsert("AAPL", [C, D, A, B], [VECTORS[2]!, VECTORS[3]!, VECTORS[0]!, VECTORS[1]!]);
    const matches = await store.query("AAPL", QUERY, 10);
    expect(matches.map((m) => m.chunk.id)).toEqual(["a", "b", "c", "d"]);
    expect(matches[0]!.score).toBeCloseTo(1.0, 6);
    expect(matches[1]!.score).toBeCloseTo(0.6, 6);
    expect(matches[2]!.score).toBeCloseTo(0.0, 6);
    expect(matches[3]!.score).toBeCloseTo(-1.0, 6);
  });

  it("normalises internally — an unnormalised query vector gives the same ranking and scores", async () => {
    await store.upsert("AAPL", [A, B, C], [VECTORS[0]!, VECTORS[1]!, VECTORS[2]!]);
    const scaled = await store.query("AAPL", [7, 0, 0], 3);
    expect(scaled.map((m) => m.chunk.id)).toEqual(["a", "b", "c"]);
    expect(scaled[1]!.score).toBeCloseTo(0.6, 6);
  });

  it("respects topK", async () => {
    await store.upsert("AAPL", [A, B, C, D], VECTORS);
    expect(await store.query("AAPL", QUERY, 1)).toHaveLength(1);
    expect((await store.query("AAPL", QUERY, 2)).map((m) => m.chunk.id)).toEqual(["a", "b"]);
    expect(await store.query("AAPL", QUERY, 100)).toHaveLength(4);
  });

  it("isolates namespaces", async () => {
    await store.upsert("AAPL", [A], [[1, 0, 0]]);
    await store.upsert("MSFT", [B], [[1, 0, 0]]);
    expect((await store.query("AAPL", QUERY, 10)).map((m) => m.chunk.id)).toEqual(["a"]);
    expect((await store.query("MSFT", QUERY, 10)).map((m) => m.chunk.id)).toEqual(["b"]);
    expect(await store.query("NVDA", QUERY, 10)).toEqual([]);
  });

  it("upserts by id — re-upserting the same chunk id replaces rather than duplicates", async () => {
    await store.upsert("AAPL", [A], [[1, 0, 0]]);
    await store.upsert("AAPL", [chunk("a", { text: "updated text" })], [[0, 1, 0]]);
    const matches = await store.query("AAPL", [0, 1, 0], 10);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.chunk.text).toBe("updated text");
    expect(matches[0]!.score).toBeCloseTo(1, 6);
  });

  it("clearNamespace empties only the target namespace", async () => {
    await store.upsert("AAPL", [A, B], [VECTORS[0]!, VECTORS[1]!]);
    await store.upsert("MSFT", [C], [VECTORS[2]!]);
    await store.clearNamespace("AAPL");
    expect(await store.query("AAPL", QUERY, 10)).toEqual([]);
    expect(await store.query("MSFT", QUERY, 10)).toHaveLength(1);
    // Clearing an unknown namespace must be a no-op, not a throw.
    await expect(store.clearNamespace("NOPE")).resolves.toBeUndefined();
  });

  it("tolerates an empty upsert", async () => {
    await expect(store.upsert("AAPL", [], [])).resolves.toBeUndefined();
    expect(await store.query("AAPL", QUERY, 10)).toEqual([]);
  });
});
