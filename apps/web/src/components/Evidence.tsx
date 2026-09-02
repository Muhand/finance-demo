"use client";

import { useState } from "react";
import type { Citation, SubAnswer } from "@finance-demo/contracts";
import { fmtDate } from "@/lib/format";
import { AlertIcon, CaretIcon, ExternalIcon } from "./icons";
import s from "./ui.module.css";

/**
 * Sub-answers with their citations. This is the trust surface of the product:
 * every generated claim is one click away from the verbatim filing text it
 * came from, with the retrieval score shown so a weak match reads as weak.
 */
export function SubAnswers({ subAnswers }: { subAnswers: readonly SubAnswer[] }) {
  if (subAnswers.length === 0) return null;

  const totalCitations = subAnswers.reduce((n, sa) => n + sa.citations.length, 0);
  const ungrounded = subAnswers.filter((sa) => !sa.grounded).length;

  return (
    <section aria-labelledby="evidence-heading">
      <p className={s.sectionLabel} id="evidence-heading">
        Supporting research · {subAnswers.length} question
        {subAnswers.length === 1 ? "" : "s"} · {totalCitations} citation
        {totalCitations === 1 ? "" : "s"}
        {ungrounded > 0 ? ` · ${ungrounded} ungrounded` : ""}
      </p>
      <div className={s.subList}>
        {subAnswers.map((sa, i) => (
          <SubAnswerCard key={`${i}-${sa.question}`} sub={sa} index={i + 1} />
        ))}
      </div>
    </section>
  );
}

function SubAnswerCard({ sub, index }: { sub: SubAnswer; index: number }) {
  const [open, setOpen] = useState(false);
  const panelId = `sub-${index}-evidence`;
  const count = sub.citations.length;

  return (
    <article className={s.subCard}>
      <header className={s.subHead}>
        <span className={s.subIndex}>Q{index}</span>
        <h4 className={s.subQuestion}>{sub.question}</h4>
        {sub.grounded ? (
          <span className={s.badge}>{count} source{count === 1 ? "" : "s"}</span>
        ) : (
          <span className={`${s.badge} ${s.badgeWarn}`}>
            <AlertIcon size={11} /> ungrounded
          </span>
        )}
      </header>

      <div className={s.subBody}>
        <p className={s.subAnswerText}>{sub.answer}</p>

        {!sub.grounded ? (
          <span className={s.ungrounded}>
            <AlertIcon size={13} />
            The retriever found nothing relevant in the indexed filings for this
            question — treat the answer above as unsupported.
          </span>
        ) : null}

        {count > 0 ? (
          <>
            <button
              type="button"
              className={s.evidenceToggle}
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((v) => !v)}
            >
              <span className={`${s.disclosureCaret} ${open ? s.disclosureCaretOpen : ""}`}>
                <CaretIcon size={12} />
              </span>
              {open ? "Hide" : "Show"} evidence ({count})
            </button>
            <div id={panelId} hidden={!open}>
              <ul className={s.citationList}>
                {sub.citations.map((c, i) => (
                  <CitationRow key={`${c.accessionNumber}-${i}`} citation={c} />
                ))}
              </ul>
            </div>
          </>
        ) : null}
      </div>
    </article>
  );
}

function CitationRow({ citation }: { citation: Citation }) {
  const pct = Math.round(Math.min(1, Math.max(0, citation.score)) * 100);
  return (
    <li className={s.citation}>
      <div className={s.citationMeta}>
        <strong>{citation.formType}</strong>
        <span>{fmtDate(citation.filingDate)}</span>
        {citation.section ? <span>Item {citation.section}</span> : null}
        <span
          className={s.scoreBar}
          role="img"
          aria-label={`Relevance ${pct} percent`}
          title={`Cosine similarity ${citation.score.toFixed(3)}`}
        >
          <span className={s.scoreBarFill} style={{ width: `${pct}%` }} />
        </span>
        <span>{pct}%</span>
        <a href={citation.url} target="_blank" rel="noopener noreferrer" className={s.filingLink}>
          {citation.accessionNumber} <ExternalIcon size={11} />
        </a>
      </div>
      <blockquote className={s.citationSnippet}>{citation.snippet}</blockquote>
    </li>
  );
}
