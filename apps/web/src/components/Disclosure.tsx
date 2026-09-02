"use client";

import { useId, useState, type ReactNode } from "react";
import { CaretIcon } from "./icons";
import s from "./ui.module.css";

/** Accessible collapsible block — button + region, no <details> quirks. */
export function Disclosure({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  return (
    <div className={s.disclosure}>
      <button
        type="button"
        className={s.disclosureButton}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        id={`${id}-button`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`${s.disclosureCaret} ${open ? s.disclosureCaretOpen : ""}`}>
          <CaretIcon size={13} />
        </span>
        <span>{title}</span>
        <span className={s.disclosureSpacer} />
        {meta}
      </button>
      <div
        id={`${id}-panel`}
        role="region"
        aria-labelledby={`${id}-button`}
        className={s.disclosurePanel}
        hidden={!open}
      >
        {children}
      </div>
    </div>
  );
}
