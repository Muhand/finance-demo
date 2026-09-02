"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TickerEntry } from "@finance-demo/contracts";
import { DEFAULT_LIMIT, findExactSymbol, rankTickers } from "@/lib/rank";
import { CloseIcon, SearchIcon } from "./icons";
import s from "./ui.module.css";

export type TickerPickerProps = {
  /** The preloaded directory. Empty while loading, or if the load failed. */
  entries: readonly TickerEntry[];
  /** True when the directory could not be loaded — enables free-text entry. */
  degraded: boolean;
  onSelect: (entry: TickerEntry) => void;
  size?: "hero" | "compact";
  placeholder?: string;
  autoFocus?: boolean;
  label: string;
  /** Rendered inside the field on the right (e.g. an "Esc" hint). */
  trailing?: React.ReactNode;
  onEscape?: () => void;
  /** Increment to imperatively move focus into the field. */
  focusSignal?: number;
};

const MAX_RENDERED = DEFAULT_LIMIT;

export function TickerPicker({
  entries,
  degraded,
  onSelect,
  size = "hero",
  placeholder = "Search 10,391 SEC-registered companies…",
  autoFocus = false,
  label,
  trailing,
  onEscape,
  focusSignal = 0,
}: TickerPickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const inputId = `${baseId}-input`;
  const statusId = `${baseId}-status`;

  // Rendering is deferred, not the filtering: keystrokes stay on the fast path
  // and React renders the (expensive) 25-row list at low priority.
  const deferredQuery = useDeferredValue(query);
  const stale = deferredQuery !== query;

  const results = useMemo(
    () => rankTickers(entries, deferredQuery, MAX_RENDERED),
    [entries, deferredQuery],
  );

  // Free-text escape hatch: with no directory we can't rank, but the user can
  // still type a symbol and go.
  const freeText = useMemo<TickerEntry | null>(() => {
    const raw = query.trim().toUpperCase();
    if (!degraded || raw.length === 0 || raw.length > 10) return null;
    if (!/^[A-Z0-9.\-]+$/.test(raw)) return null;
    return { t: raw, n: "Unverified symbol — entered manually", c: "" };
  }, [degraded, query]);

  const options = useMemo<TickerEntry[]>(
    () => (freeText ? [freeText] : results),
    [freeText, results],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [deferredQuery, degraded]);

  // Focus management: "Change ticker" hands focus to this field without a
  // navigation or remount.
  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus();
  }, [focusSignal]);

  // Keep the active option scrolled into view during keyboard traversal.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.children[activeIndex];
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  // Click-away closes the popup.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const commit = useCallback(
    (entry: TickerEntry | undefined) => {
      if (!entry) return;
      // Prefer the canonical directory row when the user typed a bare symbol.
      const canonical = entry.c === "" ? findExactSymbol(entries, entry.t) ?? entry : entry;
      setQuery("");
      setOpen(false);
      setActiveIndex(0);
      inputRef.current?.blur();
      onSelect(canonical);
    },
    [entries, onSelect],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        if (options.length > 0) setActiveIndex((i) => (i + 1) % options.length);
        return;
      case "ArrowUp":
        event.preventDefault();
        if (options.length > 0) {
          setActiveIndex((i) => (i - 1 + options.length) % options.length);
        }
        return;
      case "Home":
        if (open && options.length > 0) {
          event.preventDefault();
          setActiveIndex(0);
        }
        return;
      case "End":
        if (open && options.length > 0) {
          event.preventDefault();
          setActiveIndex(options.length - 1);
        }
        return;
      case "Enter":
        if (open && options.length > 0) {
          event.preventDefault();
          commit(options[activeIndex]);
        }
        return;
      case "Escape":
        event.preventDefault();
        if (open && query !== "") {
          setOpen(false);
        } else if (query !== "") {
          setQuery("");
        } else {
          onEscape?.();
          inputRef.current?.blur();
        }
        return;
      case "Tab":
        setOpen(false);
        return;
      default:
    }
  };

  const expanded = open && query.trim() !== "";
  const lg = size === "hero";

  const statusText = (() => {
    if (query.trim() === "") return "";
    if (freeText) return "Directory unavailable — press Enter to use the symbol as typed.";
    if (stale) return "Filtering…";
    if (options.length === 0) return "No matching companies.";
    return `${options.length} suggestion${options.length === 1 ? "" : "s"}. Use arrow keys to review.`;
  })();

  return (
    <div className={s.combo} ref={rootRef}>
      <label className="sr-only" htmlFor={inputId}>
        {label}
      </label>
      <div className={`${s.comboField} ${lg ? s.comboFieldLg : ""}`}>
        <span className={s.comboIcon}>
          <SearchIcon size={lg ? 18 : 15} />
        </span>
        <input
          id={inputId}
          ref={inputRef}
          className={`${s.comboInput} ${lg ? s.comboInputLg : ""}`}
          type="text"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-describedby={statusId}
          aria-activedescendant={
            expanded && options.length > 0 ? `${baseId}-opt-${activeIndex}` : undefined
          }
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (query.trim() !== "") setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {query !== "" ? (
          <button
            type="button"
            className={s.comboClear}
            onClick={() => {
              setQuery("");
              setOpen(false);
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            <CloseIcon size={14} />
          </button>
        ) : (
          trailing
        )}
      </div>

      <p id={statusId} className="sr-only" aria-live="polite">
        {statusText}
      </p>

      {expanded ? (
        <ul className={s.listbox} id={listboxId} role="listbox" ref={listRef} aria-label="Company suggestions">
          {options.length === 0 ? (
            <li className={s.optionEmpty} role="presentation">
              {stale ? "Filtering…" : `No company matches “${query.trim()}”.`}
            </li>
          ) : (
            options.map((entry, i) => (
              <li
                key={`${entry.t}-${entry.c}`}
                id={`${baseId}-opt-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                className={`${s.option} ${i === activeIndex ? s.optionActive : ""}`}
                onMouseEnter={() => setActiveIndex(i)}
                onPointerDown={(e) => {
                  e.preventDefault();
                  commit(entry);
                }}
              >
                <span className={s.optionSymbol}>
                  <Highlight text={entry.t} query={deferredQuery} />
                </span>
                <span className={s.optionName} title={entry.n}>
                  <Highlight text={entry.n} query={deferredQuery} />
                </span>
                {entry.c ? <span className={s.optionCik}>CIK {entry.c}</span> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

/** Bolds the matched run so the ranking is legible at a glance. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (q === "") return <>{text}</>;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className={s.optionHit}>{text.slice(at, at + q.length)}</span>
      {text.slice(at + q.length)}
    </>
  );
}
