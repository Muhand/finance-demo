/**
 * Sample 10-K item text. Deliberately longer than CHUNKING.size (1800) so that
 * multi-chunk splitting and overlap behaviour are genuinely exercised.
 *
 * BODY_SENTINEL is planted in the prose so integration tests can prove that
 * filing *content* never reaches `generateResearchQuestions` (metadata-only
 * constraint, docs/ARCHITECTURE.md "Key constraint").
 */
export const BODY_SENTINEL = "ZZQQ-FILING-BODY-SENTINEL-8814";

export const RISK_FACTORS_TEXT = [
  "Item 1A. Risk Factors.",
  "",
  "The Company's business, reputation, results of operations, financial condition and stock price can be affected by a number of factors, whether currently known or unknown, including those described below. When any one or more of these risks materialize from time to time, the Company's business, reputation, results of operations, financial condition and stock price can be materially and adversely affected.",
  "",
  "Because of the following factors, as well as other factors affecting the Company's results of operations and financial condition, past financial performance should not be considered to be a reliable indicator of future performance, and investors should not use historical trends to anticipate results or trends in future periods. This discussion of risk factors contains forward-looking statements. " + BODY_SENTINEL + " This section should be read in conjunction with Part II, Item 7, Management's Discussion and Analysis of Financial Condition and Results of Operations.",
  "",
  "Macroeconomic and Industry Risks",
  "",
  "The Company's operations and performance depend significantly on global and regional economic conditions and adverse economic conditions can materially adversely affect the Company's business, results of operations and financial condition. The Company has international operations with sales outside the U.S. representing a majority of the Company's total net sales. In addition, a majority of the Company's supply chain, and its manufacturing and assembly activities, are located outside the U.S. As a result, the Company's operations and performance depend significantly on global and regional economic conditions.",
  "",
  "Adverse macroeconomic conditions, including slow growth or recession, high unemployment, inflation, tighter credit, higher interest rates, and currency fluctuations, can adversely impact consumer confidence and spending and materially adversely affect demand for the Company's products and services. In addition, consumer confidence and spending can be materially adversely affected in response to changes in fiscal and monetary policy, financial market volatility, declines in income or asset values, and other economic factors.",
  "",
  "The Company's business can be impacted by political events, trade and other international disputes, war, terrorism, natural disasters, public health issues, industrial accidents and other business interruptions. Political events, trade and other international disputes, war, terrorism, natural disasters, public health issues, industrial accidents and other business interruptions can harm or disrupt international commerce and the global economy, and could have a material adverse effect on the Company and its customers, employees, suppliers, contract manufacturers, logistics providers, distributors, cellular network carriers and other channel partners.",
  "",
  "Business Risks",
  "",
  "The Company's success depends largely on the continued service and availability of highly skilled employees, including key personnel. Much of the Company's future success depends on the continued availability and service of key personnel, including its Chief Executive Officer, executive team and other highly skilled employees. Experienced personnel in the technology industry are in high demand and competition for their talents is intense, especially in Silicon Valley, where most of the Company's key personnel are located.",
  "",
  "The Company depends on component and product manufacturing and logistical services provided by outsourcing partners, many of which are located outside of the U.S. Substantially all of the Company's manufacturing is performed in whole or in part by outsourcing partners located primarily in Asia, and a significant concentration of this manufacturing is currently performed by a small number of outsourcing partners, often in single locations.",
  "",
  "Legal and Regulatory Compliance Risks",
  "",
  "The Company is subject to complex and changing laws and regulations worldwide, which exposes the Company to potential liabilities, increased costs and other adverse effects on the Company's business. The Company's global operations are subject to complex and changing laws and regulations on subjects including antitrust; privacy, data security and data localization; consumer protection; digital platforms; environmental, social and governance; media, advertising and content; product liability; and tax.",
].join("\n");

export const MDA_TEXT = [
  "Item 7. Management's Discussion and Analysis of Financial Condition and Results of Operations.",
  "",
  "The following discussion should be read in conjunction with the consolidated financial statements and accompanying notes included in Part II, Item 8 of this Form 10-K. This section generally discusses the results of operations for the current fiscal year compared to the prior fiscal year.",
  "",
  "Fiscal Year Highlights",
  "",
  "Total net sales increased 2% or $7.5 billion during 2024 compared to 2023, driven primarily by higher net sales of Services, partially offset by lower net sales of iPad and Wearables, Home and Accessories. The Company's total net sales were $391.0 billion for 2024. Products net sales were $294.9 billion and Services net sales were $96.2 billion, with Services representing an increasingly significant share of total gross margin.",
  "",
  "Gross Margin",
  "",
  "Products gross margin percentage increased during 2024 compared to 2023 due to a different Products mix and lower Products costs, partially offset by the weakness in foreign currencies relative to the U.S. dollar. Services gross margin percentage was relatively flat during 2024 compared to 2023. Total gross margin percentage was 46.2% in 2024 compared to 44.1% in 2023.",
  "",
  "Operating Expenses",
  "",
  "Research and development expense increased 5% during 2024 compared to 2023 due primarily to higher headcount-related expenses. Selling, general and administrative expense was relatively flat during 2024 compared to 2023. The Company continues to believe that focused investments in research and development are critical to its future growth and competitive position in the marketplace, and to the development of new and updated products and services that are central to the Company's core business strategy.",
  "",
  "Provision for Income Taxes",
  "",
  "The Company's effective tax rate for 2024 was 24.1% compared to 14.7% for 2023. The Company's effective tax rate for 2024 was higher than the statutory federal income tax rate due primarily to the one-time charge from the State Aid Decision, partially offset by a lower effective tax rate on foreign earnings, the impact of the U.S. federal research and development credit, and tax benefits from share-based compensation.",
  "",
  "Liquidity and Capital Resources",
  "",
  "The Company believes its balances of unrestricted cash, cash equivalents and marketable securities, along with cash generated by ongoing operations and continued access to debt markets, will be sufficient to satisfy its cash requirements and capital return program over the next 12 months and beyond. The Company's contractual cash requirements have not changed materially since the 2023 Form 10-K, except for manufacturing purchase obligations.",
  "",
  "Critical Accounting Estimates",
  "",
  "The preparation of financial statements and related disclosures in conformity with GAAP and the Company's discussion and analysis of its financial condition and operating results require the Company's management to make judgments, assumptions and estimates that affect the amounts reported. Note 1, Summary of Significant Accounting Policies, of the Notes to Consolidated Financial Statements describes the significant accounting policies and methods used in the preparation of the Company's consolidated financial statements.",
].join("\n");

/** Sections shaped exactly as `loadFilingSections` is specified to return them. */
export const AAPL_10K_SECTIONS: Array<{ section: string | null; text: string }> = [
  { section: "1A", text: RISK_FACTORS_TEXT },
  { section: "7", text: MDA_TEXT },
];

/** A section list containing an empty section, to check chunkers skip it. */
export const SECTIONS_WITH_EMPTY: Array<{ section: string | null; text: string }> = [
  { section: "1A", text: RISK_FACTORS_TEXT },
  { section: "9B", text: "   \n\t  " },
  { section: null, text: MDA_TEXT },
];
