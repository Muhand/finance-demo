import { Pinecone } from "@pinecone-database/pinecone";

import { ChunkSchema, type Chunk } from "@finance-demo/contracts";

import { warnOnce } from "./log.ts";

export interface VectorMatch {
  chunk: Chunk;
  score: number;
}

export interface VectorStore {
  upsert(namespace: string, chunks: Chunk[], vectors: number[][]): Promise<void>;
  query(namespace: string, vector: number[], topK: number): Promise<VectorMatch[]>;
  clearNamespace(namespace: string): Promise<void>;
}

export const DEFAULT_PINECONE_INDEX = "finance-demo";

function cosine(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** In-process cosine store. Deterministic offline stand-in for Pinecone. */
export class MemoryVectorStore implements VectorStore {
  #namespaces = new Map<string, Map<string, { chunk: Chunk; vector: number[] }>>();

  #ns(namespace: string): Map<string, { chunk: Chunk; vector: number[] }> {
    let ns = this.#namespaces.get(namespace);
    if (!ns) {
      ns = new Map();
      this.#namespaces.set(namespace, ns);
    }
    return ns;
  }

  async upsert(namespace: string, chunks: Chunk[], vectors: number[][]): Promise<void> {
    const ns = this.#ns(namespace);
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const vector = vectors[i];
      if (!chunk || !vector) continue;
      ns.set(chunk.id, { chunk, vector: [...vector] });
    }
  }

  async query(namespace: string, vector: number[], topK: number): Promise<VectorMatch[]> {
    const ns = this.#namespaces.get(namespace);
    if (!ns || ns.size === 0) return [];
    const scored: VectorMatch[] = [];
    for (const record of ns.values()) {
      scored.push({ chunk: record.chunk, score: cosine(vector, record.vector) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(0, Math.floor(topK)));
  }

  async clearNamespace(namespace: string): Promise<void> {
    this.#namespaces.delete(namespace);
  }

  /** Test/debug helper: number of vectors currently held in a namespace. */
  size(namespace: string): number {
    return this.#namespaces.get(namespace)?.size ?? 0;
  }
}

type PineconeMetadata = Record<string, string | number | boolean | string[]>;

function toMetadata(chunk: Chunk): PineconeMetadata {
  return {
    ticker: chunk.ticker,
    accessionNumber: chunk.accessionNumber,
    formType: chunk.formType,
    filingDate: chunk.filingDate,
    // Pinecone metadata cannot hold null; "" round-trips back to null.
    section: chunk.section ?? "",
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
    url: chunk.url,
  };
}

function fromMetadata(id: string, metadata: Record<string, unknown> | undefined): Chunk {
  const m = metadata ?? {};
  const str = (key: string): string => (typeof m[key] === "string" ? (m[key] as string) : "");
  const section = str("section");
  return ChunkSchema.parse({
    id,
    ticker: str("ticker"),
    accessionNumber: str("accessionNumber"),
    formType: str("formType"),
    filingDate: str("filingDate"),
    section: section === "" ? null : section,
    chunkIndex: Number.isFinite(Number(m.chunkIndex)) ? Math.max(0, Math.trunc(Number(m.chunkIndex))) : 0,
    text: str("text"),
    url: str("url"),
  });
}

/**
 * Pinecone-backed store. The index must exist with **dimension 384** and
 * **metric cosine**; one namespace per ticker.
 */
export class PineconeStore implements VectorStore {
  readonly indexName: string;
  #client: Pinecone;

  constructor(opts: { apiKey: string; indexName?: string }) {
    this.#client = new Pinecone({ apiKey: opts.apiKey });
    this.indexName = opts.indexName?.trim() || DEFAULT_PINECONE_INDEX;
  }

  #index() {
    return this.#client.index(this.indexName);
  }

  async upsert(namespace: string, chunks: Chunk[], vectors: number[][]): Promise<void> {
    const records = chunks
      .map((chunk, i) => {
        const values = vectors[i];
        return values ? { id: chunk.id, values: [...values], metadata: toMetadata(chunk) } : null;
      })
      .filter((r): r is { id: string; values: number[]; metadata: PineconeMetadata } => r !== null);

    const ns = this.#index().namespace(namespace);
    const BATCH = 100;
    for (let i = 0; i < records.length; i += BATCH) {
      await ns.upsert({ records: records.slice(i, i + BATCH) });
    }
  }

  async query(namespace: string, vector: number[], topK: number): Promise<VectorMatch[]> {
    const result = await this.#index()
      .namespace(namespace)
      .query({ vector, topK: Math.max(1, Math.floor(topK)), includeMetadata: true });

    return (result.matches ?? []).map((match) => ({
      chunk: fromMetadata(match.id, match.metadata as Record<string, unknown> | undefined),
      score: typeof match.score === "number" ? match.score : 0,
    }));
  }

  async clearNamespace(namespace: string): Promise<void> {
    try {
      await this.#index().namespace(namespace).deleteAll();
    } catch {
      // A namespace that has never been written to 404s; that is a no-op here.
    }
  }
}

/** Real Pinecone when `PINECONE_API_KEY` is set, deterministic memory store otherwise. */
export function createVectorStore(env: NodeJS.ProcessEnv = process.env): VectorStore {
  const apiKey = env.PINECONE_API_KEY?.trim();
  if (apiKey) {
    return new PineconeStore({ apiKey, indexName: env.PINECONE_INDEX });
  }
  warnOnce(
    "vectorstore",
    "PINECONE_API_KEY is not set: using the in-process MemoryVectorStore (cosine, offline). " +
      "Vectors are not persisted across restarts.",
  );
  return new MemoryVectorStore();
}
