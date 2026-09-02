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

export function defaultCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.RESEARCH_CACHE_DIR?.trim();
  return override ? path.resolve(override) : path.join(APP_ROOT, ".data", "research");
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
