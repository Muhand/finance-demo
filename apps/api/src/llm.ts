import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";

import { SummarySchema, type Quote, type SubAnswer, type Summary } from "@finance-demo/contracts";

import { warn, warnOnce } from "./log.ts";
import type { VectorMatch } from "./vectorstore.ts";

/** Metadata about one filing. Deliberately carries NO filing content. */
export interface FilingMetadata {
  formType: string;
  filingDate: string;
  periodOfReport: string | null;
  /** Names of the extractable sections, e.g. ["1", "1A", "7"]. Names only. */
  sections: string[];
}

export interface Llm {
  /**
   * IMPORTANT ARCHITECTURAL CONSTRAINT: this call receives filing METADATA
   * ONLY (form type, date, period, available section names) and never filing
   * content. Filing text reaches the model exclusively through
   * `answerFromContext`, via sub-agent retrieval from the vector store.
   */
  generateResearchQuestions(input: {
    userQuestion: string;
    ticker: string;
    filings: FilingMetadata[];
  }): Promise<string[]>;

  answerFromContext(input: { question: string; matches: VectorMatch[] }): Promise<string>;

  synthesize(input: {
    userQuestion: string;
    ticker: string;
    companyName: string;
    quote: Quote | null;
    subAnswers: SubAnswer[];
  }): Promise<Summary>;
}

export const MIN_RESEARCH_QUESTIONS = 3;
export const MAX_RESEARCH_QUESTIONS = 6;

/** Per CLAUDE.md. Both overridable via env. */
export const DEFAULT_SYNTHESIS_MODEL = "claude-sonnet-5";
export const DEFAULT_SUBAGENT_MODEL = "claude-haiku-4-5";

const SECTION_LABELS: Record<string, string> = {
  "1": "Business",
  "1A": "Risk Factors",
  "1B": "Unresolved Staff Comments",
  "2": "Properties",
  "3": "Legal Proceedings",
  "5": "Market for Registrant's Common Equity",
  "7": "Management's Discussion and Analysis",
  "7A": "Quantitative and Qualitative Disclosures About Market Risk",
  "8": "Financial Statements and Supplementary Data",
  "9A": "Controls and Procedures",
};

export function sectionLabel(section: string | null): string {
  if (!section) return "full document";
  const key = section.toUpperCase().replace(/^ITEM\s*/i, "");
  return SECTION_LABELS[key] ? `Item ${key} (${SECTION_LABELS[key]})` : `Item ${key}`;
}

function clampQuestions(questions: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of questions) {
    const q = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (!q) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length === MAX_RESEARCH_QUESTIONS) break;
  }
  return out;
}

function firstSentences(text: string, count: number): string {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const parts = clean.split(/(?<=[.!?])\s+/).slice(0, count);
  return parts.join(" ").trim();
}

function excerpt(text: string, max = 400): string {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trimEnd()}...`;
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return String(Number(value.toFixed(4)));
}

/* ------------------------------------------------------------------ */
/* Deterministic offline fake                                          */
/* ------------------------------------------------------------------ */

/**
 * Deterministic, credential-free `Llm`. Same input always yields the same
 * output, so the whole graph is reproducible offline and testable.
 */
export class StubLlm implements Llm {
  async generateResearchQuestions(input: {
    userQuestion: string;
    ticker: string;
    filings: FilingMetadata[];
  }): Promise<string[]> {
    const { ticker, userQuestion, filings } = input;
    const sections = new Set<string>();
    for (const filing of filings) {
      for (const section of filing.sections) sections.add(section.toUpperCase());
    }

    const questions: string[] = [
      `What do ${ticker}'s most recent SEC filings say about: ${userQuestion.replace(/\s+/g, " ").trim()}?`,
    ];

    const bySection: Array<[string, string]> = [
      ["1A", `What material risk factors does ${ticker} disclose in Item 1A?`],
      ["7", `What does ${ticker}'s MD&A say about recent performance, margins and outlook?`],
      ["1", `How does ${ticker} describe its business, products and primary revenue drivers?`],
      ["8", `What do ${ticker}'s financial statements show about revenue, profitability and cash flow?`],
      ["7A", `What market risks (interest rate, foreign exchange, commodity) is ${ticker} exposed to?`],
      ["3", `What legal proceedings or regulatory matters is ${ticker} involved in?`],
    ];
    for (const [section, question] of bySection) {
      if (sections.has(section)) questions.push(question);
    }

    for (const filing of filings) {
      if (questions.length >= MAX_RESEARCH_QUESTIONS) break;
      const period = filing.periodOfReport ? ` covering ${filing.periodOfReport}` : "";
      questions.push(
        `What did ${ticker} report in the ${filing.formType} filed ${filing.filingDate}${period}?`,
      );
    }

    const fallbacks = [
      `What are the most important recent developments disclosed by ${ticker}?`,
      `What forward-looking guidance or uncertainty does ${ticker} flag?`,
      `What competitive or macroeconomic pressures does ${ticker} identify?`,
    ];
    for (const fallback of fallbacks) {
      if (questions.length >= MIN_RESEARCH_QUESTIONS) break;
      questions.push(fallback);
    }

    return clampQuestions(questions);
  }

  async answerFromContext(input: { question: string; matches: VectorMatch[] }): Promise<string> {
    const { question, matches } = input;
    if (matches.length === 0) {
      return (
        `No supporting passage was retrieved from the indexed filings for "${question}". ` +
        "This answer is ungrounded and should not be relied on."
      );
    }

    const top = matches.slice(0, 3);
    const sources = top
      .map((m) => `${m.chunk.formType} ${m.chunk.filingDate} ${sectionLabel(m.chunk.section)}`)
      .join("; ");

    const body = top
      .map((m, i) => `(${i + 1}) ${firstSentences(m.chunk.text, 3) || excerpt(m.chunk.text, 300)}`)
      .join(" ");

    return (
      `Drawing on ${matches.length} retrieved passage(s) from ${sources}: ${body}`.trim()
    );
  }

  async synthesize(input: {
    userQuestion: string;
    ticker: string;
    companyName: string;
    quote: Quote | null;
    subAnswers: SubAnswer[];
  }): Promise<Summary> {
    const { userQuestion, ticker, companyName, quote, subAnswers } = input;
    const grounded = subAnswers.filter((s) => s.grounded);
    const citations = subAnswers.flatMap((s) => s.citations);

    const priceBit =
      quote && quote.price !== null
        ? `${formatNumber(quote.price)} ${quote.currency ?? ""}`.trim() +
          (quote.changePercent !== null ? ` (${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%)` : "")
        : "no live quote";

    const headline =
      `${companyName} (${ticker}) at ${priceBit}: ` +
      `${grounded.length} of ${subAnswers.length} research questions grounded in SEC filings.`;

    const narrative = [
      `You asked: "${userQuestion.replace(/\s+/g, " ").trim()}"`,
      quote && quote.price !== null
        ? `${ticker} last traded at ${formatNumber(quote.price)} ${quote.currency ?? ""} as of ${quote.asOf}.`.replace(/\s+/g, " ")
        : `No real-time quote was available for ${ticker} at the time of this request.`,
      grounded.length > 0
        ? `The research below is drawn from ${citations.length} passage(s) across the company's most recent filings.`
        : "No filing passages could be retrieved, so the findings below are not grounded in filing text.",
      "Each section names the research question a sub-agent answered against the filing index.",
    ].join(" ");

    const keyPoints: Array<{ label: string; detail: string }> = [];
    if (quote) {
      if (quote.price !== null) {
        keyPoints.push({ label: "Price", detail: `${formatNumber(quote.price)} ${quote.currency ?? ""}`.trim() });
      }
      if (quote.changePercent !== null) {
        keyPoints.push({
          label: "Change",
          detail: `${quote.change !== null ? formatNumber(quote.change) : "n/a"} (${quote.changePercent.toFixed(2)}%)`,
        });
      }
      if (quote.marketCap !== null) {
        keyPoints.push({ label: "Market cap", detail: formatNumber(quote.marketCap) });
      }
      if (quote.peRatio !== null) {
        keyPoints.push({ label: "Trailing P/E", detail: formatNumber(quote.peRatio) });
      }
      if (quote.fiftyTwoWeekLow !== null && quote.fiftyTwoWeekHigh !== null) {
        keyPoints.push({
          label: "52-week range",
          detail: `${formatNumber(quote.fiftyTwoWeekLow)} - ${formatNumber(quote.fiftyTwoWeekHigh)}`,
        });
      }
    }
    keyPoints.push({
      label: "Filing evidence",
      detail: `${citations.length} citation(s) across ${new Set(citations.map((c) => c.accessionNumber)).size} filing(s)`,
    });

    const risks: string[] = [];
    for (const sub of subAnswers) {
      const isRisk = /risk|litigation|legal|uncertain|competition|regulat/i.test(sub.question);
      const hasRiskCitation = sub.citations.some((c) => (c.section ?? "").toUpperCase() === "1A");
      if (!isRisk && !hasRiskCitation) continue;
      const line = firstSentences(sub.answer, 2);
      if (line) risks.push(line);
    }
    if (risks.length === 0) {
      risks.push(
        "No risk-specific disclosures were retrieved for this question; consult Item 1A of the latest 10-K directly.",
      );
    }

    const sections = subAnswers.map((sub) => ({
      title: sub.question,
      body: sub.grounded ? sub.answer : `${sub.answer} (ungrounded)`,
    }));
    if (sections.length === 0) {
      sections.push({
        title: "No research performed",
        body: "No filings were available to research for this ticker.",
      });
    }

    return SummarySchema.parse({ headline, narrative, keyPoints, risks, sections });
  }
}

/* ------------------------------------------------------------------ */
/* Anthropic-backed implementation                                     */
/* ------------------------------------------------------------------ */

const QuestionsSchema = z.object({ questions: z.array(z.string()).min(1) });

const LlmSummarySchema = z.object({
  headline: z.string(),
  narrative: z.string(),
  keyPoints: z.array(z.object({ label: z.string(), detail: z.string() })).default([]),
  risks: z.array(z.string()).default([]),
  sections: z.array(z.object({ title: z.string(), body: z.string() })).default([]),
});

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "text" in block) {
          const text = (block as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

/**
 * Every balanced `{...}` / `[...]` span in `text`, outermost first.
 *
 * The naive "first bracket to last bracket" slice breaks on real model output:
 * a bracket inside prose before the JSON shifts the start, and a bracket in
 * trailing prose extends the end past the value. This scans with a depth
 * counter that respects strings and escapes, so a brace inside a narrative
 * string cannot close the object early.
 */
function extractJsonCandidates(text: string, max = 5): string[] {
  const found: string[] = [];
  for (let i = 0; i < text.length && found.length < max; i += 1) {
    const open = text[i];
    if (open !== "{" && open !== "[") continue;
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j += 1) {
      const c = text[j];
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { if (inString) escaped = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === open) depth += 1;
      else if (c === close) {
        depth -= 1;
        if (depth === 0) { found.push(text.slice(i, j + 1)); i = j; break; }
      }
    }
  }
  return found;
}

function parseJsonBlock<T>(raw: string, schema: z.ZodType<T>): T {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  const candidates = extractJsonCandidates(text);
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return schema.parse(JSON.parse(candidate));
    } catch (err) {
      lastError = err;
    }
  }
  // No balanced span at all usually means the response was truncated.
  const reason = candidates.length === 0 ? "no balanced JSON value (truncated?)" : describe(lastError);
  throw new Error(`could not parse model JSON: ${reason}; response began: ${text.slice(0, 200)}`);
}

export class AnthropicLlm implements Llm {
  readonly synthesisModel: string;
  readonly subAgentModel: string;
  #apiKey: string;
  #fallback = new StubLlm();

  #workspaceId: string | undefined;

  constructor(opts: {
    apiKey: string;
    synthesisModel?: string;
    subAgentModel?: string;
    workspaceId?: string;
  }) {
    this.#apiKey = opts.apiKey;
    this.synthesisModel = opts.synthesisModel?.trim() || DEFAULT_SYNTHESIS_MODEL;
    this.subAgentModel = opts.subAgentModel?.trim() || DEFAULT_SUBAGENT_MODEL;
    this.#workspaceId = opts.workspaceId?.trim() || undefined;
  }

  #chat(model: string, maxTokens: number): ChatAnthropic {
    return new ChatAnthropic({
      apiKey: this.#apiKey,
      model,
      maxTokens,
      // No `temperature`: sampling parameters are rejected with a 400 on
      // Sonnet 5 / Opus 5 and the rest of the 4.7+ family.
      ...(this.#workspaceId
        ? {
            // Identity-linked API keys must name the workspace the request
            // acts in, or every call fails with a 400.
            clientOptions: {
              defaultHeaders: { "anthropic-workspace-id": this.#workspaceId },
            },
          }
        : {}),
    });
  }

  async #ask(model: string, maxTokens: number, system: string, user: string): Promise<string> {
    const response = await this.#chat(model, maxTokens).invoke([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    return extractText(response.content);
  }

  async generateResearchQuestions(input: {
    userQuestion: string;
    ticker: string;
    filings: FilingMetadata[];
  }): Promise<string[]> {
    // ARCHITECTURAL REQUIREMENT (docs/ARCHITECTURE.md, "Key constraint"):
    // this prompt is built from filing METADATA ONLY. Filing body text must
    // never be interpolated here. Content reaches the model only via
    // `answerFromContext`, from vector-store retrieval.
    const metadata = input.filings.map((f) => ({
      formType: f.formType,
      filingDate: f.filingDate,
      periodOfReport: f.periodOfReport,
      availableSections: f.sections,
    }));

    const system =
      "You plan SEC filing research. You are given a user's question and only the METADATA of the " +
      "filings available (form type, filing date, period, and the names of extractable sections). " +
      "You never see filing text. Propose research questions that a retrieval sub-agent can answer " +
      "from those filings. " +
      `Reply with JSON only: {"questions": string[]} containing between ${MIN_RESEARCH_QUESTIONS} ` +
      `and ${MAX_RESEARCH_QUESTIONS} specific, non-overlapping questions.`;

    const user = [
      `Ticker: ${input.ticker}`,
      `User question: ${input.userQuestion}`,
      "Available filings (metadata only):",
      JSON.stringify(metadata, null, 2),
    ].join("\n");

    try {
      const raw = await this.#ask(this.subAgentModel, 1024, system, user);
      const parsed = parseJsonBlock(raw, QuestionsSchema);
      const questions = clampQuestions(parsed.questions);
      if (questions.length >= MIN_RESEARCH_QUESTIONS) return questions;
      warn("AnthropicLlm returned too few research questions; padding with deterministic ones.");
    } catch (err) {
      // Configured but failing is NOT the offline path: substituting template
      // text here would present generated filler as filing-grounded research.
      throw new Error(`Anthropic generateResearchQuestions failed: ${describe(err)}`);
    }
    return this.#fallback.generateResearchQuestions(input);
  }

  async answerFromContext(input: { question: string; matches: VectorMatch[] }): Promise<string> {
    if (input.matches.length === 0) {
      return this.#fallback.answerFromContext(input);
    }

    const context = input.matches
      .map((m, i) => {
        const head = `[${i + 1}] ${m.chunk.formType} filed ${m.chunk.filingDate}, ${sectionLabel(m.chunk.section)} (score ${m.score.toFixed(3)})`;
        return `${head}\n${m.chunk.text}`;
      })
      .join("\n\n---\n\n");

    const system =
      "You are a research sub-agent. Answer the question using ONLY the retrieved filing passages " +
      "below. Cite passages inline as [1], [2]. If the passages do not answer the question, say so " +
      "plainly. Answer in 2-5 sentences. No preamble.";

    try {
      return await this.#ask(
        this.subAgentModel,
        2048,
        system,
        `Question: ${input.question}\n\nRetrieved passages:\n${context}`,
      );
    } catch (err) {
      throw new Error(`Anthropic answerFromContext failed: ${describe(err)}`);
    }
  }

  async synthesize(input: {
    userQuestion: string;
    ticker: string;
    companyName: string;
    quote: Quote | null;
    subAnswers: SubAnswer[];
  }): Promise<Summary> {
    const system =
      "You are a financial research analyst. Synthesize a real-time quote and a set of " +
      "filing-grounded sub-answers into one answer to the user's question. Be specific and " +
      "cite filing sections in prose where relevant. Never invent numbers. " +
      'Reply with JSON only, shaped as {"headline": string, "narrative": string, ' +
      '"keyPoints": [{"label": string, "detail": string}], "risks": string[], ' +
      '"sections": [{"title": string, "body": string}]}. ' +
      "headline is one line; narrative is 2-4 sentences.";

    const user = JSON.stringify(
      {
        userQuestion: input.userQuestion,
        ticker: input.ticker,
        companyName: input.companyName,
        quote: input.quote,
        subAnswers: input.subAnswers.map((s) => ({
          question: s.question,
          answer: s.answer,
          grounded: s.grounded,
          citations: s.citations.map((c) => ({
            formType: c.formType,
            filingDate: c.filingDate,
            section: c.section,
            snippet: c.snippet,
          })),
        })),
      },
      null,
      2,
    );

    try {
      const raw = await this.#ask(this.synthesisModel, 8192, system, user);
      const parsed = parseJsonBlock(raw, LlmSummarySchema);
      return SummarySchema.parse(parsed);
    } catch (err) {
      throw new Error(`Anthropic synthesize failed: ${describe(err)}`);
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Real Anthropic models when `ANTHROPIC_API_KEY` is set, deterministic stub otherwise. */
export function createLlm(env: NodeJS.ProcessEnv = process.env): Llm {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) {
    return new AnthropicLlm({
      apiKey,
      synthesisModel: env.ANTHROPIC_SYNTHESIS_MODEL,
      subAgentModel: env.ANTHROPIC_SUBAGENT_MODEL,
      workspaceId: env.ANTHROPIC_WORKSPACE_ID,
    });
  }
  warnOnce(
    "llm",
    "ANTHROPIC_API_KEY is not set: using the deterministic offline StubLlm. " +
      "Research questions, sub-answers and the summary are template-generated, not model-generated.",
  );
  return new StubLlm();
}
