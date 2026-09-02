import type { AskResponse, TickerEntry } from "@finance-demo/contracts";
import type { RequestFailure } from "./api";

/** One question asked during this browser session. */
export type HistoryEntry = {
  id: string;
  ticker: string;
  companyName: string;
  question: string;
  askedAt: number;
  status: "running" | "ok" | "error";
  response: AskResponse | null;
  failure: RequestFailure | null;
};

export type PanelState =
  | { kind: "idle" }
  | { kind: "loading"; question: string; startedAt: number }
  | { kind: "result"; entryId: string }
  | { kind: "error"; entryId: string };

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Starter questions offered under the question box. Kept generic on purpose —
 * they read as prompts for the pipeline, not as canned answers.
 */
export function suggestionsFor(entry: TickerEntry): string[] {
  const name = shortName(entry.n);
  return [
    `What are the biggest risks ${name} disclosed in its most recent filings?`,
    `How has ${name}'s revenue mix changed, and what is driving it?`,
    `What did management say about margins and cost pressure?`,
    `Summarise ${name}'s liquidity, debt and capital-return position.`,
  ];
}

export function shortName(raw: string): string {
  return raw
    .replace(/\b(inc|corp|corporation|co|company|ltd|limited|plc|holdings|group|sa|nv|ag)\b\.?/gi, "")
    .replace(/[,\s]+$/g, "")
    .trim() || raw;
}
