import { warnOnce } from "./log.ts";

/** MiniLM-L6-v2 output width. Pinecone index must match: dimension 384, cosine. */
export const EMBEDDING_DIM = 384;

export const DEFAULT_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

export interface Embedder {
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

function l2normalize(vector: number[], dim: number): number[] {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm === 0) {
    // Keep the "unit length" invariant even for empty input.
    const unit = new Array<number>(dim).fill(0);
    unit[0] = 1;
    return unit;
  }
  return vector.map((value) => value / norm);
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Deterministic, dependency-free, offline embedder.
 *
 * Signed feature hashing over unigrams + adjacent bigrams. It is not a
 * semantic model, but it is stable across processes, needs no credentials and
 * no model download, and gives cosine similarity enough signal for lexical
 * retrieval, which is what the offline demo path needs.
 */
export class HashEmbedder implements Embedder {
  readonly dim: number;

  constructor(dim: number = EMBEDDING_DIM) {
    this.dim = dim;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  embedOne(text: string): number[] {
    const vector = new Array<number>(this.dim).fill(0);
    const tokens = String(text ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? [];

    const add = (feature: string, weight: number): void => {
      const index = fnv1a(feature) % this.dim;
      const sign = (fnv1a(`${feature} sign`) & 1) === 0 ? 1 : -1;
      vector[index] = (vector[index] ?? 0) + sign * weight;
    };

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i] as string;
      add(token, 1);
      const next = tokens[i + 1];
      if (next) add(`${token} ${next}`, 0.5);
    }

    return l2normalize(vector, this.dim);
  }
}

interface TransformersTensor {
  data: ArrayLike<number>;
  dims: number[];
}

type FeatureExtractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<TransformersTensor>;

const TRANSFORMERS_PACKAGE = "@huggingface/transformers";

// Indirect so the specifier is not statically analyzable: the package is a
// heavy optional extra (onnxruntime is ~220MB unpacked) and is not installed
// by default. See apps/api/README.md.
const importOptional = (specifier: string): Promise<unknown> => import(specifier);

/** Real embedder: `Xenova/all-MiniLM-L6-v2` run locally via ONNX. No API key. */
export class LocalEmbedder implements Embedder {
  readonly dim = EMBEDDING_DIM;
  readonly model: string;
  #extractor: Promise<FeatureExtractor> | null = null;

  constructor(model: string = DEFAULT_EMBEDDING_MODEL) {
    this.model = model;
  }

  async #pipeline(): Promise<FeatureExtractor> {
    if (!this.#extractor) {
      const pending = (async (): Promise<FeatureExtractor> => {
        let mod: { pipeline?: unknown };
        try {
          mod = (await importOptional(TRANSFORMERS_PACKAGE)) as { pipeline?: unknown };
        } catch (cause) {
          throw new Error(
            `LocalEmbedder requires the optional dependency "${TRANSFORMERS_PACKAGE}". ` +
              `Install it (pnpm --filter @finance-demo/api add ${TRANSFORMERS_PACKAGE}) ` +
              "or unset EMBEDDER=local.",
            { cause },
          );
        }
        const factory = mod.pipeline as
          | ((task: string, model: string) => Promise<FeatureExtractor>)
          | undefined;
        if (typeof factory !== "function") {
          throw new Error(`"${TRANSFORMERS_PACKAGE}" did not export a pipeline() factory`);
        }
        return factory("feature-extraction", this.model);
      })();
      pending.catch(() => {
        this.#extractor = null;
      });
      this.#extractor = pending;
    }
    return this.#extractor;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extract = await this.#pipeline();
    const tensor = await extract(texts, { pooling: "mean", normalize: true });
    const width = tensor.dims[tensor.dims.length - 1] ?? this.dim;
    const out: number[][] = [];
    for (let row = 0; row < texts.length; row += 1) {
      const vector = new Array<number>(width);
      for (let col = 0; col < width; col += 1) {
        vector[col] = Number(tensor.data[row * width + col] ?? 0);
      }
      out.push(l2normalize(vector, width));
    }
    return out;
  }
}

/**
 * `EMBEDDER=local` gives the real MiniLM embedder.
 * Anything else gives the deterministic offline `HashEmbedder` (the default),
 * so the whole graph runs with zero credentials and zero model downloads.
 */
export function createEmbedder(env: NodeJS.ProcessEnv = process.env): Embedder {
  const mode = (env.EMBEDDER ?? "").trim().toLowerCase();
  if (mode === "local") {
    return new LocalEmbedder(env.EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL);
  }
  warnOnce(
    "embedder",
    `EMBEDDER is not "local": using the offline HashEmbedder (${EMBEDDING_DIM}d, deterministic). ` +
      "Set EMBEDDER=local for Xenova/all-MiniLM-L6-v2.",
  );
  return new HashEmbedder();
}
