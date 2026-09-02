"use client";

import { useEffect, useRef, useState } from "react";
import type { TickerEntry } from "@finance-demo/contracts";
import type { HistoryEntry } from "@/lib/session";
import { suggestionsFor } from "@/lib/session";
import { fmtDuration } from "@/lib/format";
import { SpinnerIcon } from "./icons";
import s from "./ui.module.css";

const MIN_LEN = 3;
const MAX_LEN = 2000;

export type QuestionPanelProps = {
  ticker: TickerEntry;
  busy: boolean;
  history: readonly HistoryEntry[];
  activeEntryId: string | null;
  onSubmit: (question: string) => void;
  onChangeTicker: () => void;
  onSelectHistory: (entry: HistoryEntry) => void;
  /** Focus target when the two-panel view first appears. */
  focusOnMount: boolean;
};

export function QuestionPanel({
  ticker,
  busy,
  history,
  activeEntryId,
  onSubmit,
  onChangeTicker,
  onSelectHistory,
  focusOnMount,
}: QuestionPanelProps) {
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus management: when the panels appear, the question box is where the
  // user has to act next, so it takes focus.
  useEffect(() => {
    if (focusOnMount) textareaRef.current?.focus();
  }, [focusOnMount, ticker.t]);

  const trimmed = text.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_LEN;
  const tooLong = trimmed.length > MAX_LEN;
  const canSubmit = !busy && trimmed.length >= MIN_LEN && !tooLong;

  const submit = () => {
    setTouched(true);
    if (!canSubmit) return;
    onSubmit(trimmed);
  };

  const tickerHistory = history.filter((h) => h.ticker === ticker.t);

  return (
    <div className={s.panel}>
      <div className={s.panelHead}>
        <h2 className={s.panelTitle}>Ask</h2>
        <span className={s.mastheadSpacer} />
        <span className={s.badge}>{ticker.t}</span>
      </div>

      <div className={s.panelBody}>
        <form
          className={s.askForm}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className={s.tickerChip}>
            <span className={s.tickerChipSymbol}>{ticker.t}</span>
            <span className={s.tickerChipName} title={ticker.n}>
              {ticker.n}
            </span>
            <button type="button" className={s.chipButton} onClick={onChangeTicker}>
              Change
            </button>
          </div>

          <label className={s.askLabel} htmlFor="question-input">
            Your question
          </label>
          <textarea
            id="question-input"
            ref={textareaRef}
            className={s.textarea}
            value={text}
            disabled={busy}
            maxLength={MAX_LEN + 200}
            placeholder={`e.g. What is putting pressure on ${ticker.t}'s gross margin?`}
            aria-describedby="question-hint"
            aria-invalid={touched && (tooShort || tooLong) ? true : undefined}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
          />

          <div className={s.askFooter}>
            <span
              id="question-hint"
              className={`${s.hint} ${touched && (tooShort || tooLong) ? s.hintError : ""}`}
            >
              {tooShort
                ? `At least ${MIN_LEN} characters.`
                : tooLong
                  ? `${trimmed.length.toLocaleString()} / ${MAX_LEN.toLocaleString()} characters.`
                  : "⌘↵ to submit"}
            </span>
            <button type="submit" className={s.button} disabled={!canSubmit}>
              {busy ? (
                <>
                  <SpinnerIcon size={14} className={s.spin} />
                  Researching…
                </>
              ) : (
                "Ask"
              )}
            </button>
          </div>
        </form>

        {tickerHistory.length === 0 ? (
          <div style={{ marginTop: 18 }}>
            <p className={s.sectionLabel}>Try one of these</p>
            <ul className={s.suggestList}>
              {suggestionsFor(ticker).map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    className={s.suggest}
                    disabled={busy}
                    onClick={() => {
                      setText(q);
                      textareaRef.current?.focus();
                    }}
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {history.length > 0 ? (
          <div style={{ marginTop: 18 }}>
            <p className={s.sectionLabel}>This session ({history.length})</p>
            <ul className={s.historyList}>
              {history.map((entry) => {
                const dot =
                  entry.status === "running"
                    ? s.historyDotRun
                    : entry.status === "ok"
                      ? s.historyDotOk
                      : s.historyDotErr;
                return (
                  <li key={entry.id} className={s.historyItem}>
                    <button
                      type="button"
                      className={`${s.historyButton} ${
                        entry.id === activeEntryId ? s.historyButtonActive : ""
                      }`}
                      onClick={() => onSelectHistory(entry)}
                      aria-current={entry.id === activeEntryId ? "true" : undefined}
                    >
                      <span className={s.historyQ}>{entry.question}</span>
                      <span className={s.historyMeta}>
                        <span className={`${s.historyDot} ${dot}`} aria-hidden="true" />
                        <span>{entry.ticker}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {new Date(entry.askedAt).toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                        {entry.response ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{fmtDuration(entry.response.timings.totalMs)}</span>
                          </>
                        ) : null}
                        {entry.failure ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{entry.failure.code}</span>
                          </>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
