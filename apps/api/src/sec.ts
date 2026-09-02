import { Company, setIdentity, type Filing } from "sec-edgar-toolkit";

import type { FilingRef } from "@finance-demo/contracts";

import { info } from "./log.ts";

/** Forms we research, newest first. */
export const DEFAULT_FORMS = ["10-K", "10-Q", "8-K"] as const;

/** How many recent filings to pull when the caller does not say. */
export const DEFAULT_FILING_LIMIT = 3;

const DEFAULT_USER_AGENT = "FinanceDemo/1.0 (emhsmath@gmail.com)";

/**
 * Filing objects keyed by accession number, so `loadFilingSections` can reuse
 * the object produced by `getFilingRefs` instead of re-walking EDGAR.
 */
const filingsByAccession = new Map<string, Filing>();

let identitySet = false;

/** EDGAR requires a descriptive User-Agent on every request. */
export function initSec(env: NodeJS.ProcessEnv = process.env): void {
  const userAgent = env.SEC_USER_AGENT?.trim() || DEFAULT_USER_AGENT;
  setIdentity(userAgent);
  if (!identitySet) info(`SEC identity set to "${userAgent}"`);
  identitySet = true;
}

function ensureIdentity(): void {
  if (!identitySet) initSec();
}

function toFilingRef(filing: Filing): FilingRef {
  return {
    accessionNumber: filing.accessionNumber,
    formType: filing.formType,
    filingDate: filing.filingDate,
    periodOfReport: filing.periodOfReport || null,
    primaryDocument: filing.primaryDocument || null,
    url: filing.url,
  };
}

/** Newest accession number known to EDGAR for this CIK, across DEFAULT_FORMS. */
export async function getLatestAccession(cik: string): Promise<string | null> {
  ensureIdentity();
  const company = await Company.lookup(cik);
  const filings = await company.getFilings({ form: [...DEFAULT_FORMS], limit: 1 });
  const latest = filings.latest();
  return latest ? latest.accessionNumber : null;
}

/** The `limit` most recent filings for a CIK, newest first. */
export async function getFilingRefs(
  cik: string,
  opts: { forms?: string[]; limit?: number } = {},
): Promise<FilingRef[]> {
  ensureIdentity();
  const forms = opts.forms ?? [...DEFAULT_FORMS];
  const limit = Math.max(1, Math.floor(opts.limit ?? DEFAULT_FILING_LIMIT));

  const company = await Company.lookup(cik);
  const filings = await company.getFilings({ form: forms, limit });

  const refs: FilingRef[] = [];
  for (const filing of Array.from(filings).slice(0, limit)) {
    filingsByAccession.set(filing.accessionNumber, filing);
    refs.push(toFilingRef(filing));
  }
  return refs;
}

async function rehydrate(ref: FilingRef): Promise<Filing> {
  const cached = filingsByAccession.get(ref.accessionNumber);
  if (cached) return cached;

  const cik = /\/data\/(\d+)\//.exec(ref.url)?.[1];
  if (!cik) {
    throw new Error(`Cannot locate filing ${ref.accessionNumber}: no CIK in ${ref.url}`);
  }

  const company = await Company.lookup(cik);
  const filings = await company.getFilings({ form: ref.formType, limit: 50 });
  const found = Array.from(filings).find((f) => f.accessionNumber === ref.accessionNumber);
  if (!found) {
    throw new Error(`Filing ${ref.accessionNumber} not found for CIK ${cik}`);
  }
  filingsByAccession.set(ref.accessionNumber, found);
  return found;
}

/**
 * Extract the researchable text of one filing.
 *
 * For 10-K/10-Q we prefer `extractItems()`: it yields clean, per-item prose,
 * whereas `text()` on those forms begins with a couple of KB of raw XBRL
 * context. Everything else falls back to the tag-stripped full document.
 */
export async function loadFilingSections(
  ref: FilingRef,
): Promise<Array<{ section: string | null; text: string }>> {
  ensureIdentity();
  const filing = await rehydrate(ref);

  if (/^10-[KQ]/i.test(ref.formType)) {
    try {
      const items = await filing.extractItems();
      const sections = Object.entries(items)
        .filter(([, text]) => typeof text === "string" && text.trim().length > 0)
        .map(([section, text]) => ({ section, text }));
      if (sections.length > 0) return sections;
    } catch {
      // Item extraction can fail on older/odd filings; fall through to text().
    }
  }

  const text = await filing.text("text");
  return text.trim().length > 0 ? [{ section: null, text }] : [];
}

/** Test seam: drop the in-process Filing object cache. */
export function resetSecCache(): void {
  filingsByAccession.clear();
}
