import type { AskResponse, TickerEntry } from "@finance-demo/contracts";

/**
 * Dev-only fixtures, used ONLY when NEXT_PUBLIC_FIXTURES=1. The shipped
 * default calls the real /api/* routes; this exists so the UI can be built and
 * exercised while the backend is still being written.
 */

export const FIXTURE_TICKERS: TickerEntry[] = [
  { t: "NVDA", n: "NVIDIA CORP", c: "0001045810" },
  { t: "AAPL", n: "Apple Inc.", c: "0000320193" },
  { t: "MSFT", n: "MICROSOFT CORP", c: "0000789019" },
  { t: "AMZN", n: "AMAZON COM INC", c: "0001018724" },
  { t: "GOOGL", n: "Alphabet Inc.", c: "0001652044" },
  { t: "TSLA", n: "Tesla, Inc.", c: "0001318605" },
  { t: "AA", n: "Alcoa Corp", c: "0001675149" },
  { t: "AAL", n: "American Airlines Group Inc.", c: "0000006201" },
  { t: "COST", n: "COSTCO WHOLESALE CORP /NEW", c: "0000909832" },
  { t: "JPM", n: "JPMORGAN CHASE & CO", c: "0000019617" },
];

export function fixtureResponse(ticker: string, question: string): AskResponse {
  const now = new Date().toISOString();
  return {
    requestId: "fixture-0001",
    ticker,
    companyName: "NVIDIA Corporation",
    question,
    askedAt: now,
    quote: {
      symbol: ticker,
      name: "NVIDIA Corporation",
      price: 178.42,
      change: -3.11,
      changePercent: -1.71,
      currency: "USD",
      marketCap: 4_352_000_000_000,
      dayHigh: 182.9,
      dayLow: 176.55,
      volume: 184_223_100,
      fiftyTwoWeekHigh: 212.19,
      fiftyTwoWeekLow: 86.62,
      peRatio: 51.3,
      asOf: now,
    },
    summary: {
      headline:
        "Data-center demand still drives essentially all growth, but supply concentration and customer concentration are the two risks management keeps flagging.",
      narrative:
        "Data Center revenue accounts for the overwhelming majority of total revenue and continues to grow faster than every other segment. Gross margin remains in the low-to-mid 70s, supported by mix rather than price. The filings repeatedly tie both upside and downside to a small number of foundry partners and a small number of hyperscale customers.",
      keyPoints: [
        { label: "Revenue mix", detail: "Data Center is the dominant segment; Gaming, ProViz and Automotive are now rounding error by comparison." },
        { label: "Gross margin", detail: "Low-to-mid 70s percent, described as mix-driven and sensitive to component costs." },
        { label: "Customer concentration", detail: "A handful of direct customers each represent 10%+ of revenue." },
        { label: "Supply", detail: "Substantially dependent on a small number of third-party foundry and packaging partners." },
      ],
      risks: [
        "Concentration of manufacturing with a limited number of foundry and advanced-packaging suppliers; a disruption at any one of them would be material.",
        "Export controls and licensing requirements can restrict sales into specific regions with little notice.",
        "Demand is concentrated in a small number of large customers, whose capital-spending plans can change abruptly.",
      ],
      sections: [
        {
          title: "Segment performance",
          body: "Data Center revenue growth is attributed to accelerated computing platforms sold to cloud service providers and consumer internet companies. Gaming is described as stabilising. Professional Visualization and Automotive remain small in absolute terms.",
        },
        {
          title: "Margin and cost structure",
          body: "Management attributes gross-margin strength to product mix and higher-value platforms rather than list-price increases. Operating expense growth is framed as headcount and compute investment for research.",
        },
        {
          title: "Liquidity and capital return",
          body: "Cash and marketable securities remain substantial relative to debt. Buybacks are the primary capital-return mechanism; the dividend is nominal.",
        },
      ],
    },
    filings: [
      {
        accessionNumber: "0001045810-25-000023",
        formType: "10-K",
        filingDate: "2025-02-26",
        periodOfReport: "2025-01-26",
        primaryDocument: "nvda-20250126.htm",
        url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581025000023/nvda-20250126.htm",
      },
      {
        accessionNumber: "0001045810-25-000151",
        formType: "10-Q",
        filingDate: "2025-08-27",
        periodOfReport: "2025-07-27",
        primaryDocument: "nvda-20250727.htm",
        url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581025000151/nvda-20250727.htm",
      },
    ],
    subAnswers: [
      {
        question: "How concentrated is the customer base?",
        answer:
          "Several direct customers each accounted for 10% or more of total revenue in the most recent fiscal year, and indirect demand is concentrated in a similarly small set of hyperscale buyers.",
        grounded: true,
        citations: [
          {
            accessionNumber: "0001045810-25-000023",
            formType: "10-K",
            filingDate: "2025-02-26",
            section: "1A",
            snippet:
              "We have experienced periods where we received a significant amount of our revenue from a limited number of customers, and this trend may continue. A reduction in orders from any such customer could have a material adverse effect on our results of operations.",
            score: 0.874,
            url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581025000023/nvda-20250126.htm",
          },
          {
            accessionNumber: "0001045810-25-000151",
            formType: "10-Q",
            filingDate: "2025-08-27",
            section: "2",
            snippet:
              "Sales to direct customers which represented 10% or more of total revenue accounted for a majority of total revenue for the period, all of which were attributable to the Compute & Networking segment.",
            score: 0.812,
            url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581025000151/nvda-20250727.htm",
          },
        ],
      },
      {
        question: "What did management say about gross margin direction?",
        answer:
          "Gross margin is framed as mix-driven, with management pointing to higher-value data-center platforms rather than pricing actions.",
        grounded: true,
        citations: [
          {
            accessionNumber: "0001045810-25-000151",
            formType: "10-Q",
            filingDate: "2025-08-27",
            section: "7",
            snippet:
              "Gross margin increased primarily due to a favourable shift in product mix toward higher-margin Data Center offerings, partially offset by higher inventory provisions and increased costs for advanced packaging.",
            score: 0.791,
            url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581025000151/nvda-20250727.htm",
          },
        ],
      },
      {
        question: "Are there disclosed constraints on manufacturing capacity?",
        answer:
          "The retriever found no passage in the indexed filings that directly addresses near-term capacity commitments.",
        grounded: false,
        citations: [],
      },
    ],
    cache: {
      filingsReused: true,
      reason: "no-new-filings-reused",
      lastAccession: "0001045810-25-000151",
      researchedAt: new Date(Date.now() - 3_600_000).toISOString(),
    },
    timings: {
      totalMs: 24_180,
      quoteMs: 612,
      filingsMs: 1_940,
      embedMs: 120,
      questionGenMs: 3_410,
      subAgentsMs: 10_890,
      synthesisMs: 7_208,
    },
  };
}
