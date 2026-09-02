import type { AskResponse, FilingRef, Summary } from "@finance-demo/contracts";
import { fmtDate, fmtDuration, fmtTimestamp } from "@/lib/format";
import { CacheIcon, ClockIcon, DocIcon, ExternalIcon } from "./icons";
import { Disclosure } from "./Disclosure";
import { QuoteCard } from "./QuoteCard";
import { SubAnswers } from "./Evidence";
import s from "./ui.module.css";

/** The rendered AskResponse — the whole right-hand panel's payload. */
export function AnswerView({ response }: { response: AskResponse }) {
  const { summary } = response;
  return (
    <div className={s.answer}>
      <QuoteCard quote={response.quote} ticker={response.ticker} />

      <CacheNote response={response} />

      <blockquote className={s.askedQuestion}>{response.question}</blockquote>

      <div className={s.answerLead}>
        <h3 className={s.headline}>{summary.headline}</h3>
        {summary.narrative ? <p className={s.narrative}>{summary.narrative}</p> : null}
      </div>

      <KeyPoints keyPoints={summary.keyPoints} />
      <Risks risks={summary.risks} />
      <Sections sections={summary.sections} />
      <Filings filings={response.filings} />
      <SubAnswers subAnswers={response.subAnswers} />

      <ResponseFooter response={response} />
    </div>
  );
}

function CacheNote({ response }: { response: AskResponse }) {
  const { cache } = response;
  // Checked first, and independently of `filingsReused`: this is the one cache
  // state the user must not miss, so it is never gated behind another flag.
  const stale = cache.reason === "upstream-unavailable-stale";
  if (!stale && !cache.filingsReused) {
    if (cache.reason === "cold-start" || cache.reason === "new-filings-detected") {
      return (
        <p className={s.quoteFoot}>
          <span className={s.badge}>
            <DocIcon size={11} />
            {cache.reason === "cold-start" ? "First research run" : "New filings detected"}
          </span>
          <span>
            {response.filings.length} filing{response.filings.length === 1 ? "" : "s"} indexed for{" "}
            {response.ticker}.
          </span>
        </p>
      );
    }
    return null;
  }
  return (
    <p className={s.quoteFoot}>
      <span className={`${s.badge} ${stale ? s.badgeWarn : s.badgeAccent}`}>
        <CacheIcon size={11} /> {stale ? "SEC EDGAR unreachable" : "Filings unchanged"}
      </span>
      <span>
        {stale ? (
          <>
            Showing the last research we completed
            {cache.researchedAt ? `, from ${fmtTimestamp(cache.researchedAt)}` : ""} — we
            could not reach EDGAR to check for new filings. The quote above is live.
          </>
        ) : (
          <>
            Reusing prior research
            {cache.researchedAt ? ` from ${fmtTimestamp(cache.researchedAt)}` : ""} — the
            quote above is live.
          </>
        )}
      </span>
      {cache.lastAccession ? (
        <span className="num">latest {cache.lastAccession}</span>
      ) : null}
    </p>
  );
}

function KeyPoints({ keyPoints }: { keyPoints: Summary["keyPoints"] }) {
  if (keyPoints.length === 0) return null;
  return (
    <section aria-labelledby="keypoints-heading">
      <p className={s.sectionLabel} id="keypoints-heading">
        Key points
      </p>
      <dl className={s.keyPoints}>
        {keyPoints.map((kp, i) => (
          <div key={`${kp.label}-${i}`} style={{ display: "contents" }}>
            <dt className={s.keyPointLabel}>{kp.label}</dt>
            <dd className={s.keyPointDetail}>{kp.detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Risks({ risks }: { risks: readonly string[] }) {
  if (risks.length === 0) return null;
  return (
    <section aria-labelledby="risks-heading">
      <p className={s.sectionLabel} id="risks-heading">
        Risks ({risks.length})
      </p>
      <ul className={s.riskList}>
        {risks.map((risk, i) => (
          <li key={`${i}-${risk.slice(0, 24)}`} className={s.riskItem}>
            <span className={s.riskIndex} aria-hidden="true">
              R{i + 1}
            </span>
            <span>{risk}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Sections({ sections }: { sections: Summary["sections"] }) {
  if (sections.length === 0) return null;
  return (
    <section aria-labelledby="sections-heading">
      <p className={s.sectionLabel} id="sections-heading">
        Detail
      </p>
      <div>
        {sections.map((sec, i) => (
          <Disclosure key={`${sec.title}-${i}`} title={sec.title} defaultOpen={i === 0}>
            <p className={s.prose}>{sec.body}</p>
          </Disclosure>
        ))}
      </div>
    </section>
  );
}

function Filings({ filings }: { filings: readonly FilingRef[] }) {
  if (filings.length === 0) return null;
  return (
    <section aria-labelledby="filings-heading">
      <p className={s.sectionLabel} id="filings-heading">
        Filings used ({filings.length})
      </p>
      <ul className={s.filingList}>
        {filings.map((f) => (
          <li key={f.accessionNumber} className={s.filingRow}>
            <span className={s.filingForm}>{f.formType}</span>
            <span className={s.filingDate}>{fmtDate(f.filingDate)}</span>
            <span className={s.filingPeriod}>
              {f.periodOfReport ? `Period ending ${fmtDate(f.periodOfReport)}` : ""}
            </span>
            <span className={s.filingAccession}>{f.accessionNumber}</span>
            <a
              className={s.filingLink}
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${f.formType} ${f.accessionNumber} on sec.gov`}
            >
              sec.gov <ExternalIcon size={11} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

const TIMING_SEGMENTS = [
  { key: "quoteMs", label: "quote", color: "#6ba3f5" },
  { key: "filingsMs", label: "filings", color: "#3fcf8e" },
  { key: "embedMs", label: "embed", color: "#e2ab4d" },
  { key: "questionGenMs", label: "plan", color: "#b07cf0" },
  { key: "subAgentsMs", label: "sub-agents", color: "#f6685e" },
  { key: "synthesisMs", label: "synthesis", color: "#4fc3d9" },
] as const;

function ResponseFooter({ response }: { response: AskResponse }) {
  const { timings } = response;
  const measured = TIMING_SEGMENTS.map((seg) => ({
    ...seg,
    ms: Number(timings[seg.key]) || 0,
  }));
  const sum = measured.reduce((n, m) => n + m.ms, 0);

  return (
    <footer>
      <div className={s.responseFoot}>
        <span className={s.badge}>
          <ClockIcon size={11} /> {fmtDuration(timings.totalMs)} total
        </span>
        <span>asked {fmtTimestamp(response.askedAt)}</span>
        <span aria-hidden="true">·</span>
        <span>req {response.requestId}</span>
      </div>
      {sum > 0 ? (
        <>
          <div className={s.timingBar} role="img" aria-label={`Pipeline timing breakdown, ${fmtDuration(timings.totalMs)} total`}>
            {measured.map((m) =>
              m.ms > 0 ? (
                <span
                  key={m.key}
                  className={s.timingSeg}
                  style={{ width: `${(m.ms / sum) * 100}%`, background: m.color }}
                  title={`${m.label} ${fmtDuration(m.ms)}`}
                />
              ) : null,
            )}
          </div>
          <div className={s.timingLegend} style={{ marginTop: 6 }}>
            {measured.map((m) => (
              <span key={m.key} className={s.timingLegendItem}>
                <span className={s.timingSwatch} style={{ background: m.color }} />
                {m.label} {fmtDuration(m.ms)}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </footer>
  );
}
