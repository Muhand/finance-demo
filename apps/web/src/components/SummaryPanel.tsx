"use client";

import type { AskResponse, TickerEntry } from "@finance-demo/contracts";
import { ERROR_COPY, type RequestFailure } from "@/lib/api";
import { fmtDuration } from "@/lib/format";
import { PIPELINE, useProgress } from "@/lib/progress";
import type { PanelState } from "@/lib/session";
import { AlertIcon, CheckIcon, DocIcon, SpinnerIcon } from "./icons";
import { AnswerView } from "./AnswerView";
import s from "./ui.module.css";

export type SummaryPanelProps = {
  ticker: TickerEntry;
  state: PanelState;
  response: AskResponse | null;
  failure: RequestFailure | null;
  onRetry: () => void;
};

/**
 * The right-hand, 65%-wide panel. Exactly one of idle / loading / error /
 * result is shown, and the whole region is an aria-live polite landmark so a
 * screen reader is told when a long-running answer lands.
 */
export function SummaryPanel({ ticker, state, response, failure, onRetry }: SummaryPanelProps) {
  return (
    <div className={s.panel}>
      <div className={s.panelHead}>
        <h2 className={s.panelTitle}>Summary</h2>
        <span className={s.mastheadSpacer} />
        {state.kind === "loading" ? (
          <span className={`${s.badge} ${s.badgeAccent}`}>
            <SpinnerIcon size={11} className={s.spin} /> working
          </span>
        ) : state.kind === "result" && response ? (
          <span className={s.badge}>{fmtDuration(response.timings.totalMs)}</span>
        ) : null}
      </div>

      <div
        className={s.panelBody}
        aria-live="polite"
        aria-busy={state.kind === "loading"}
        aria-atomic="false"
      >
        {state.kind === "idle" ? <IdleState ticker={ticker} /> : null}
        {state.kind === "loading" ? (
          <LoadingState question={state.question} startedAt={state.startedAt} ticker={ticker} />
        ) : null}
        {state.kind === "error" && failure ? (
          <ErrorState failure={failure} onRetry={onRetry} />
        ) : null}
        {state.kind === "result" && response ? <AnswerView response={response} /> : null}
      </div>
    </div>
  );
}

function IdleState({ ticker }: { ticker: TickerEntry }) {
  return (
    <div className={s.emptyState}>
      <span className={s.emptyIcon}>
        <DocIcon size={30} />
      </span>
      <p className={s.emptyTitle}>Nothing asked yet</p>
      <p className={s.emptyBody}>
        Ask a question about <strong>{ticker.t}</strong> on the left. The answer will
        combine a live quote with research over {ticker.n}&apos;s SEC filings, and every
        claim will link back to the filing text behind it.
      </p>
    </div>
  );
}

function LoadingState({
  question,
  startedAt,
  ticker,
}: {
  question: string;
  startedAt: number;
  ticker: TickerEntry;
}) {
  const { elapsedMs, stageIndex, fraction } = useProgress(true, startedAt);

  return (
    <div className={s.stateWrap}>
      <blockquote className={s.askedQuestion}>{question}</blockquote>

      <div className={s.progressTrack}>
        <span className={s.progressFill} style={{ width: `${fraction * 100}%` }} />
      </div>

      <ul className={s.stageList}>
        {PIPELINE.map((stage, i) => {
          const done = i < stageIndex;
          const active = i === stageIndex;
          return (
            <li
              key={stage.key}
              className={`${s.stage} ${active ? s.stageActive : done ? s.stageDone : ""}`}
            >
              <span
                className={`${s.stageMark} ${
                  done ? s.stageMarkDone : active ? s.stageMarkActive : ""
                }`}
                aria-hidden="true"
              >
                {done ? <CheckIcon size={9} /> : null}
              </span>
              <span>{stage.label}</span>
              {active ? <span className={s.stageNote}>{fmtDuration(elapsedMs)}</span> : null}
            </li>
          );
        })}
      </ul>

      <p className={s.hint}>
        Researching <strong>{ticker.t}</strong>. Stage estimates are approximate; the
        elapsed clock is real. A cold ticker takes the longest — filings have to be
        fetched, chunked and embedded before any question can be answered.
      </p>

      <div style={{ display: "grid", gap: 8, marginTop: 4 }} aria-hidden="true">
        <span className={s.skeleton} style={{ height: 20, width: "72%" }} />
        <span className={s.skeleton} style={{ height: 13, width: "96%" }} />
        <span className={s.skeleton} style={{ height: 13, width: "88%" }} />
        <span className={s.skeleton} style={{ height: 13, width: "63%" }} />
      </div>

      <p className="sr-only">
        Researching your question. Currently: {PIPELINE[stageIndex]?.label ?? "finishing up"}.
      </p>
    </div>
  );
}

function ErrorState({ failure, onRetry }: { failure: RequestFailure; onRetry: () => void }) {
  const copy = ERROR_COPY[failure.code];
  const title = failure.transport ? "Can't reach the API" : copy.title;
  const hint = failure.transport
    ? "The web app proxies /api/* to the API service (http://localhost:4000 by default, override with API_ORIGIN). Start the API and try again."
    : copy.hint;

  return (
    <div className={s.stateWrap}>
      <div className={s.errorBox} role="alert">
        <span className={s.errorCode}>
          {failure.code}
          {failure.status ? ` · HTTP ${failure.status}` : ""}
        </span>
        <h3 className={s.errorTitle}>
          <AlertIcon size={15} /> {title}
        </h3>
        <p className={s.errorMessage}>{failure.message}</p>
        <p className={s.errorHint}>{hint}</p>
        {failure.detail ? <pre className={s.errorDetail}>{failure.detail}</pre> : null}
        <div>
          <button type="button" className={`${s.button} ${s.buttonGhost}`} onClick={onRetry}>
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
