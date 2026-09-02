import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FilingRefSchema, SubAnswerSchema, type FilingRef, type SubAnswer } from "@finance-demo/contracts";
import { z } from "zod";

import { warn } from "./log.ts";

export interface ResearchRecord {
  ticker: string;
  lastAccession: string | null;
  researchedAt: string;
  filings: FilingRef[];
  subAnswers: SubAnswer[];
}

const ResearchRecordSchema = z.object({
  ticker: z.string(),
  lastAccession: z.string().nullable(),
  researchedAt: z.string(),
  filings: z.array(FilingRefSchema),
  subAnswers: z.array(SubAnswerSchema),
});

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Bumped whenever previously-cached research becomes untrustworthy. Versioning
 * the directory (rather than a field in the record) retires stale runs without
 * changing the on-disk record shape.
 *
 * v2: chunk boundaries became surrogate-safe. Research cached under v1 was
 * embedded and cited from text that could contain U+FFFD where an astral
 * character was split, and no re-read can repair it.
 */
const CACHE_SCHEMA_VERSION = "v2";

export function defaultCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.RESEARCH_CACHE_DIR?.trim();
  if (override) return path.resolve(override);
  // Serverless filesystems are read-only outside /tmp. Without this the cache
  // silently fails to persist and the whole "no new filings -> reuse prior
  // research" path stops working, with no error and a re-billed pipeline on
  // every request.
  const serverless = env.VERCEL ?? env.AWS_LAMBDA_FUNCTION_NAME;
  const root = serverless ? "/tmp" : APP_ROOT;
  return path.join(root, ".data", "research", CACHE_SCHEMA_VERSION);
}

function safeFileName(ticker: string): string {
  const symbol = String(ticker ?? "").toUpperCase().replace(/[^A-Z0-9._-]/g, "_");
  return `${symbol || "_"}.json`;
}

/**
 * Filesystem-backed store of the last completed research run per ticker.
 * This is what `checkFilingFreshness` compares EDGAR's newest accession to.
 */
export class ResearchCache {
  readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ? path.resolve(dir) : defaultCacheDir();
  }

  #pathFor(ticker: string): string {
    return path.join(this.dir, safeFileName(ticker));
  }

  async get(ticker: string): Promise<ResearchRecord | null> {
    const file = this.#pathFor(ticker);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      return null;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      warn(`Ignoring corrupt research cache at ${file}`);
      return null;
    }
    const parsed = ResearchRecordSchema.safeParse(json);
    if (!parsed.success) {
      warn(`Ignoring unreadable research cache at ${file}`);
      return null;
    }
    return parsed.data;
  }

  async set(record: ResearchRecord): Promise<void> {
    const validated = ResearchRecordSchema.parse(record);
    await mkdir(this.dir, { recursive: true });
    const file = this.#pathFor(validated.ticker);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    await rename(tmp, file);
  }
}
