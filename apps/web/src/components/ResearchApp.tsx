"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AskResponse, TickerEntry } from "@finance-demo/contracts";
import { RequestFailure, askQuestion, fetchTickers } from "@/lib/api";
import { newId, type HistoryEntry, type PanelState } from "@/lib/session";
import { QuestionPanel } from "./QuestionPanel";
import { SummaryPanel } from "./SummaryPanel";
import { TickerPicker } from "./TickerPicker";
import { AlertIcon } from "./icons";
import s from "./ui.module.css";

/**
 * Dev-only fixture mode. Off unless NEXT_PUBLIC_FIXTURES=1 at build time, so
 * the shipped default always talks to the real /api/* routes.
 */
const USE_FIXTURES = process.env.NEXT_PUBLIC_FIXTURES === "1";

export function ResearchApp() {
  const [tickers, setTickers] = useState<readonly TickerEntry[]>([]);
  const [dirStatus, setDirStatus] = useState<"loading" | "ready" | "error">("loading");
  const [dirError, setDirError] = useState<RequestFailure | null>(null);

  const [selected, setSelected] = useState<TickerEntry | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [panel, setPanel] = useState<PanelState>({ kind: "idle" });
  const [focusSignal, setFocusSignal] = useState(0);
  const [panelsJustAppeared, setPanelsJustAppeared] = useState(false);

  const inFlight = useRef<AbortController | null>(null);
  const lastQuestion = useRef<string>("");

  /* ---- preload the whole ticker directory once, on mount ---------- */
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      if (USE_FIXTURES) {
        const { FIXTURE_TICKERS } = await import("@/fixtures/sample");
        setTickers(FIXTURE_TICKERS);
        setDirStatus("ready");
        return;
      }
      try {
        const rows = await fetchTickers(ac.signal);
        if (ac.signal.aborted) return;
        setTickers(rows);
        setDirStatus("ready");
      } catch (err) {
        if (ac.signal.aborted) return;
        setDirError(
          err instanceof RequestFailure
            ? err
            : new RequestFailure({
                code: "INTERNAL",
                message: "The ticker directory failed to load.",
                detail: err instanceof Error ? err.message : String(err),
              }),
        );
        setDirStatus("error");
      }
    })();
    return () => ac.abort();
  }, []);

  useEffect(() => () => inFlight.current?.abort(), []);

  const degraded = dirStatus === "error";

  const activeEntry = useMemo<HistoryEntry | null>(() => {
    if (panel.kind !== "result" && panel.kind !== "error") return null;
    return history.find((h) => h.id === panel.entryId) ?? null;
  }, [history, panel]);

  /* ---- ticker selection ------------------------------------------ */
  const handleSelect = useCallback((entry: TickerEntry) => {
    inFlight.current?.abort();
    inFlight.current = null;
    setSelected((prev) => {
      if (prev?.t !== entry.t) setPanel({ kind: "idle" });
      return entry;
    });
    setPanelsJustAppeared(true);
  }, []);

  /* ---- ask -------------------------------------------------------- */
  const runAsk = useCallback(
    async (ticker: TickerEntry, question: string) => {
      inFlight.current?.abort();
      const ac = new AbortController();
      inFlight.current = ac;
      lastQuestion.current = question;

      const id = newId();
      const startedAt = Date.now();
      const entry: HistoryEntry = {
        id,
        ticker: ticker.t,
        companyName: ticker.n,
        question,
        askedAt: startedAt,
        status: "running",
        response: null,
        failure: null,
      };
      setHistory((prev) => [entry, ...prev].slice(0, 40));
      setPanel({ kind: "loading", question, startedAt });

      const finish = (patch: Partial<HistoryEntry>) =>
        setHistory((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h)));

      try {
        const response: AskResponse = USE_FIXTURES
          ? await fixtureAsk(ticker.t, question, ac.signal)
          : await askQuestion({ ticker: ticker.t, question }, ac.signal);
        if (ac.signal.aborted) return;
        finish({ status: "ok", response });
        setPanel({ kind: "result", entryId: id });
      } catch (err) {
        if (ac.signal.aborted) return;
        const failure =
          err instanceof RequestFailure
            ? err
            : new RequestFailure({
                code: "INTERNAL",
                message: "The request failed unexpectedly.",
                detail: err instanceof Error ? err.message : String(err),
              });
        finish({ status: "error", failure });
        setPanel({ kind: "error", entryId: id });
      } finally {
        if (inFlight.current === ac) inFlight.current = null;
      }
    },
    [],
  );

  const handleSubmit = useCallback(
    (question: string) => {
      if (selected) void runAsk(selected, question);
    },
    [runAsk, selected],
  );

  const handleRetry = useCallback(() => {
    if (selected && lastQuestion.current) void runAsk(selected, lastQuestion.current);
  }, [runAsk, selected]);

  const handleSelectHistory = useCallback((entry: HistoryEntry) => {
    if (entry.status === "ok" && entry.response) setPanel({ kind: "result", entryId: entry.id });
    else if (entry.status === "error") setPanel({ kind: "error", entryId: entry.id });
  }, []);

  /* ---- state 1: the centred picker -------------------------------- */
  if (!selected) {
    return (
      <div className={s.shell}>
        <Masthead />
        <main className={s.hero}>
          <h1 className={s.heroTitle}>Ask a question about any public company.</h1>
          <p className={s.heroLede}>
            Pick a ticker to start. Answers combine a live quote with research over that
            company&apos;s SEC filings, and every claim links back to the filing text
            behind it.
          </p>
          <div className={s.heroPicker}>
            <TickerPicker
              entries={tickers}
              degraded={degraded}
              onSelect={handleSelect}
              size="hero"
              autoFocus
              label="Search companies by ticker symbol or name"
              placeholder={
                degraded
                  ? "Directory unavailable — type a ticker symbol, e.g. AAPL"
                  : "Search by ticker or company name…"
              }
            />
          </div>
          <p className={s.heroMeta} role="status">
            <DirectoryStatus status={dirStatus} count={tickers.length} error={dirError} />
          </p>
        </main>
      </div>
    );
  }

  /* ---- state 2: the 35 / 65 split --------------------------------- */
  const busy = panel.kind === "loading";

  return (
    <div className={s.shell}>
      <Masthead>
        <div className={s.mastheadPicker}>
          <TickerPicker
            entries={tickers}
            degraded={degraded}
            onSelect={handleSelect}
            size="compact"
            label="Change company"
            placeholder="Change company…"
            focusSignal={focusSignal}
          />
        </div>
      </Masthead>

      {degraded ? (
        <div style={{ padding: "10px 20px 0", maxWidth: "var(--shell-max)", margin: "0 auto", width: "100%" }}>
          <p className={s.banner} role="status">
            <span className={s.bannerIcon}>
              <AlertIcon size={14} />
            </span>
            <span>
              The ticker directory could not be loaded ({dirError?.code}), so search
              suggestions are unavailable. You can still type a symbol directly and press
              Enter.
            </span>
          </p>
        </div>
      ) : null}

      {/* 35% / 65% — see .split in ui.module.css */}
      <main className={s.split}>
        <section className={s.splitLeft} aria-label="Question">
          <QuestionPanel
            ticker={selected}
            busy={busy}
            history={history}
            activeEntryId={activeEntry?.id ?? null}
            onSubmit={handleSubmit}
            onChangeTicker={() => setFocusSignal((n) => n + 1)}
            onSelectHistory={handleSelectHistory}
            focusOnMount={panelsJustAppeared}
          />
        </section>

        <section className={s.splitRight} aria-label="Summary">
          <SummaryPanel
            ticker={selected}
            state={panel}
            response={activeEntry?.response ?? null}
            failure={activeEntry?.failure ?? null}
            onRetry={handleRetry}
          />
        </section>
      </main>
    </div>
  );
}

function Masthead({ children }: { children?: React.ReactNode }) {
  return (
    <header className={s.masthead}>
      <span className={s.wordmark}>
        <span className={s.wordmarkDot} aria-hidden="true" />
        finance-demo
        <span className={s.wordmarkSub}>SEC filings research</span>
      </span>
      <span className={s.mastheadSpacer} />
      {children}
    </header>
  );
}

function DirectoryStatus({
  status,
  count,
  error,
}: {
  status: "loading" | "ready" | "error";
  count: number;
  error: RequestFailure | null;
}) {
  if (status === "loading") return <>Loading the SEC company directory…</>;
  if (status === "ready") {
    return <>{count.toLocaleString()} companies loaded — filtering happens locally.</>;
  }
  return (
    <span className={s.ungrounded}>
      <AlertIcon size={13} />
      Directory unavailable ({error?.code ?? "INTERNAL"}
      {error?.transport ? " — API unreachable" : ""}). Type a ticker symbol and press
      Enter.
    </span>
  );
}

async function fixtureAsk(
  ticker: string,
  question: string,
  signal: AbortSignal,
): Promise<AskResponse> {
  const { fixtureResponse } = await import("@/fixtures/sample");
  await new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, 4000);
    signal.addEventListener("abort", () => {
      clearTimeout(id);
      reject(signal.reason);
    });
  });
  return fixtureResponse(ticker, question);
}
