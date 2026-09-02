import type {
  AskResponse,
  Chunk,
  Citation,
  SubAnswer,
  Summary,
} from "@finance-demo/contracts";
import { AAPL_FILINGS, NEWEST_ACCESSION } from "./filings.js";
import { AAPL_QUOTE } from "./quote.js";

export const RISK_CITATION: Citation = {
  accessionNumber: NEWEST_ACCESSION,
  formType: "10-K",
  filingDate: "2024-11-01",
  section: "1A",
  snippet:
    "A majority of the Company's supply chain, and its manufacturing and assembly activities, are located outside the U.S.",
  score: 0.8134,
  url: AAPL_FILINGS[0]!.url,
};

export const MDA_CITATION: Citation = {
  accessionNumber: NEWEST_ACCESSION,
  formType: "10-K",
  filingDate: "2024-11-01",
  section: "7",
  snippet:
    "Total net sales increased 2% or $7.5 billion during 2024 compared to 2023, driven primarily by higher net sales of Services.",
  score: 0.7421,
  url: AAPL_FILINGS[0]!.url,
};

export const SUB_ANSWERS: SubAnswer[] = [
  {
    question: "What supply-chain concentration risks does the company disclose?",
    answer:
      "Substantially all manufacturing is performed by a small number of outsourcing partners located primarily in Asia, often in single locations, which concentrates operational risk.",
    citations: [RISK_CITATION],
    grounded: true,
  },
  {
    question: "How did gross margin move year over year and why?",
    answer:
      "Total gross margin percentage rose to 46.2% in 2024 from 44.1% in 2023, driven by product mix, lower product costs and a growing Services share, partly offset by currency weakness.",
    citations: [MDA_CITATION],
    grounded: true,
  },
  {
    question: "What did management say about capital return capacity?",
    answer: "The retriever found no relevant passage for this question.",
    citations: [],
    grounded: false,
  },
];

export const SUMMARY: Summary = {
  headline: "Apple's margin expansion is real, but its supply chain stays concentrated.",
  narrative:
    "Apple grew net sales 2% to $391.0 billion in fiscal 2024 while lifting total gross margin to 46.2%, helped by a richer Services mix. The filings continue to flag heavy dependence on a small number of Asian outsourcing partners and a rising regulatory burden across privacy, antitrust and digital-platform rules.",
  keyPoints: [
    { label: "Total net sales", detail: "$391.0B in FY2024, up 2% year over year" },
    { label: "Gross margin", detail: "46.2% vs 44.1% in FY2023" },
    { label: "Effective tax rate", detail: "24.1% in FY2024, up from 14.7%" },
    { label: "Last price", detail: "$228.52, down 0.59% on the day" },
  ],
  risks: [
    "Manufacturing concentrated with a small number of outsourcing partners, often in single Asian locations.",
    "Majority of net sales are outside the U.S., exposing results to currency and trade-policy shocks.",
    "Expanding antitrust, privacy and digital-platform regulation across multiple jurisdictions.",
  ],
  sections: [
    {
      title: "Revenue and mix",
      body: "Services net sales of $96.2 billion now carry a disproportionate share of gross margin relative to the $294.9 billion Products line, which is why blended margin expanded even with flat unit demand in iPad and Wearables.",
    },
    {
      title: "Risk factors",
      body: "Item 1A leads with macroeconomic sensitivity and supply-chain concentration, then moves to talent retention in Silicon Valley and a lengthening list of legal and regulatory exposures.",
    },
  ],
};

export const ASK_RESPONSE: AskResponse = {
  requestId: "01JH7Q9K3M4N5P6Q7R8S9T0V1W",
  ticker: "AAPL",
  companyName: "Apple Inc.",
  question: "How is Apple's margin trending and what are the biggest risks?",
  askedAt: "2025-01-15T21:00:02.512Z",
  quote: AAPL_QUOTE,
  summary: SUMMARY,
  filings: AAPL_FILINGS,
  subAnswers: SUB_ANSWERS,
  cache: {
    filingsReused: false,
    reason: "cold-start",
    lastAccession: NEWEST_ACCESSION,
    researchedAt: null,
  },
  timings: {
    totalMs: 8421,
    quoteMs: 214,
    filingsMs: 1806,
    embedMs: 2933,
    questionGenMs: 742,
    subAgentsMs: 2011,
    synthesisMs: 1615,
  },
};

/** A reused-research response: same shape, cache flags flipped, quote still fresh. */
export const ASK_RESPONSE_REUSED: AskResponse = {
  ...ASK_RESPONSE,
  requestId: "01JH7Q9K3M4N5P6Q7R8S9T0V1X",
  cache: {
    filingsReused: true,
    reason: "no-new-filings-reused",
    lastAccession: NEWEST_ACCESSION,
    researchedAt: "2025-01-15T20:41:00.000Z",
  },
  timings: { ...ASK_RESPONSE.timings, totalMs: 1904, filingsMs: 0, embedMs: 0, questionGenMs: 0, subAgentsMs: 0 },
};

export const CHUNK: Chunk = {
  id: `AAPL:${NEWEST_ACCESSION}:1A:0`,
  ticker: "AAPL",
  accessionNumber: NEWEST_ACCESSION,
  formType: "10-K",
  filingDate: "2024-11-01",
  section: "1A",
  chunkIndex: 0,
  text: "The Company's business, reputation, results of operations, financial condition and stock price can be affected by a number of factors.",
  url: AAPL_FILINGS[0]!.url,
};
