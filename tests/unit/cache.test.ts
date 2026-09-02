import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResearchRecord } from "@api/cache";
import { ResearchCache } from "@api/cache";
import { AAPL_FILINGS, NEWEST_ACCESSION, SUB_ANSWERS } from "../fixtures/index.js";

let root: string;
let dir: string;

const record = (overrides: Partial<ResearchRecord> = {}): ResearchRecord => ({
  ticker: "AAPL",
  lastAccession: NEWEST_ACCESSION,
  researchedAt: "2025-01-15T20:41:00.000Z",
  filings: AAPL_FILINGS,
  subAnswers: SUB_ANSWERS,
  ...overrides,
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "finance-demo-cache-"));
  dir = join(root, "cache");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("ResearchCache", () => {
  it("returns null for a ticker that was never cached", async () => {
    const cache = new ResearchCache(dir);
    expect(await cache.get("AAPL")).toBeNull();
  });

  it("round-trips a record, preserving every field including nested citations", async () => {
    const cache = new ResearchCache(dir);
    const rec = record();
    await cache.set(rec);
    expect(await cache.get("AAPL")).toEqual(rec);
  });

  it("persists to disk — a fresh instance over the same dir sees the record", async () => {
    await new ResearchCache(dir).set(record());
    const reopened = new ResearchCache(dir);
    expect(await reopened.get("AAPL")).toEqual(record());
    expect((await readdir(dir)).length).toBeGreaterThan(0);
  });

  it("creates the cache directory if it does not exist yet", async () => {
    const nested = join(dir, "does", "not", "exist");
    const cache = new ResearchCache(nested);
    await expect(cache.set(record())).resolves.toBeUndefined();
    expect(await cache.get("AAPL")).toEqual(record());
  });

  it("keeps tickers isolated from one another", async () => {
    const cache = new ResearchCache(dir);
    await cache.set(record());
    await cache.set(record({ ticker: "MSFT", lastAccession: "0000789019-24-000090", subAnswers: [] }));
    expect((await cache.get("AAPL"))?.lastAccession).toBe(NEWEST_ACCESSION);
    expect((await cache.get("MSFT"))?.lastAccession).toBe("0000789019-24-000090");
    expect((await cache.get("MSFT"))?.subAnswers).toEqual([]);
  });

  it("overwrites a previous record for the same ticker rather than appending", async () => {
    const cache = new ResearchCache(dir);
    await cache.set(record());
    const updated = record({ lastAccession: "0000320193-25-000004", researchedAt: "2025-02-01T00:00:00.000Z" });
    await cache.set(updated);
    expect(await cache.get("AAPL")).toEqual(updated);
  });

  it("stores a null lastAccession (a company with no filings at all)", async () => {
    const cache = new ResearchCache(dir);
    await cache.set(record({ lastAccession: null, filings: [], subAnswers: [] }));
    const got = await cache.get("AAPL");
    expect(got).not.toBeNull();
    expect(got!.lastAccession).toBeNull();
  });

  it("does not let a ticker name escape the cache directory", async () => {
    const cache = new ResearchCache(dir);
    // Whatever the sanitisation strategy (reject, encode, strip), a traversing
    // ticker must never cause a write above `dir`.
    await cache.set(record({ ticker: "../../escaped" })).catch(() => undefined);
    expect(await readdir(root)).toEqual(["cache"]);
  });
});
