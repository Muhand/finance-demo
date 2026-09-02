import type { FilingRef } from "@finance-demo/contracts";

/** Apple's CIK, 10-digit zero-padded, as it appears in the ticker directory. */
export const AAPL_CIK = "0000320193";

/**
 * Realistic EDGAR filing references for AAPL. Accession numbers use the real
 * 0000320193-YY-NNNNNN shape; URLs use the real Archives layout (accession with
 * dashes stripped in the path segment).
 */
export const AAPL_FILINGS: FilingRef[] = [
  {
    accessionNumber: "0000320193-24-000123",
    formType: "10-K",
    filingDate: "2024-11-01",
    periodOfReport: "2024-09-28",
    primaryDocument: "aapl-20240928.htm",
    url: "https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm",
  },
  {
    accessionNumber: "0000320193-24-000081",
    formType: "10-Q",
    filingDate: "2024-08-02",
    periodOfReport: "2024-06-29",
    primaryDocument: "aapl-20240629.htm",
    url: "https://www.sec.gov/Archives/edgar/data/320193/000032019324000081/aapl-20240629.htm",
  },
  {
    accessionNumber: "0000320193-24-000069",
    formType: "8-K",
    filingDate: "2024-05-02",
    periodOfReport: null,
    primaryDocument: "aapl-20240502.htm",
    url: "https://www.sec.gov/Archives/edgar/data/320193/000032019324000069/aapl-20240502.htm",
  },
];

/** The newest accession in AAPL_FILINGS — what `getLatestAccession` should return. */
export const NEWEST_ACCESSION = "0000320193-24-000123";

/** A *different* newest accession, used to simulate a fresh EDGAR filing. */
export const NEWER_ACCESSION = "0000320193-25-000004";

/** The filing that shows up when EDGAR reports NEWER_ACCESSION. */
export const NEWER_FILING: FilingRef = {
  accessionNumber: NEWER_ACCESSION,
  formType: "10-Q",
  filingDate: "2025-01-31",
  periodOfReport: "2024-12-28",
  primaryDocument: "aapl-20241228.htm",
  url: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000004/aapl-20241228.htm",
};
