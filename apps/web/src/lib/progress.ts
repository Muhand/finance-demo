"use client";

import { useEffect, useState } from "react";

/**
 * The ask endpoint is a single blocking POST that runs a multi-stage LLM
 * pipeline, so there is no server-sent progress to subscribe to. Rather than
 * show a bare spinner for 30+ seconds we advance through the pipeline's real
 * stages — the same ones the response reports in `timings` — on a schedule
 * derived from their typical cost, and hold on the last stage until the
 * response lands. The elapsed clock is always truthful even when the stage
 * estimate is not, and the copy says "estimated".
 */
export type Stage = {
  key: string;
  label: string;
  /** Typical duration of this stage, in ms. Used only for pacing the UI. */
  budgetMs: number;
};

export const PIPELINE: readonly Stage[] = [
  { key: "quote", label: "Fetching the live quote", budgetMs: 900 },
  { key: "filings", label: "Checking EDGAR for new filings", budgetMs: 3500 },
  { key: "embed", label: "Chunking and embedding filing text", budgetMs: 6000 },
  { key: "questionGen", label: "Planning research questions", budgetMs: 3500 },
  { key: "subAgents", label: "Running sub-agents over the filings index", budgetMs: 9000 },
  { key: "synthesis", label: "Synthesising the answer", budgetMs: 7000 },
];

const TOTAL_BUDGET = PIPELINE.reduce((sum, st) => sum + st.budgetMs, 0);

export type Progress = {
  elapsedMs: number;
  /** Index of the stage currently believed to be running. */
  stageIndex: number;
  /** 0..0.97 — never reaches 1 until the response actually arrives. */
  fraction: number;
};

export function useProgress(active: boolean, startedAt: number): Progress {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [active, startedAt]);

  const elapsedMs = Math.max(0, now - startedAt);

  let acc = 0;
  let stageIndex = PIPELINE.length - 1;
  for (let i = 0; i < PIPELINE.length; i++) {
    acc += PIPELINE[i]!.budgetMs;
    if (elapsedMs < acc) {
      stageIndex = i;
      break;
    }
  }

  // Asymptotic so a slow run never shows a stalled 100% bar.
  const fraction = 1 - Math.exp(-elapsedMs / (TOTAL_BUDGET * 0.55));

  return { elapsedMs, stageIndex, fraction: Math.min(0.97, fraction) };
}
