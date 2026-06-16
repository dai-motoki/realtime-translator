"use client";

// Header "My Page language" tracker — a searchable 210+ language picker, ported
// from ainewsblitz's LocaleSwitcher. Picking a language sets the UI display
// language (translated via the i18n provider) and is remembered in localStorage.
// It is independent from the conversation languages and never changes their
// translation results.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { LANGUAGES, getLanguage } from "@/lib/languages";
import { useT, useUiLang, useSetUiLang } from "@/lib/i18n";

// Major languages pinned to the top of the list (ainewsblitz priority order).
const PRIORITY = [
  "ja", "es", "zh", "hi", "ar", "fr", "pt", "bn", "ru", "de", "ko", "it", "id", "vi",
];

export function LanguageSwitcher() {
  const t = useT();
  const lang = useUiLang();
  const setLang = useSetUiLang();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Rounded down to the nearest 10 ("210+") so the label stays accurate-ish.
  const total = Math.max(10, Math.floor(LANGUAGES.length / 10) * 10);
  const current = getLanguage(lang);

  // All languages except English (shown separately as "English (original)").
  const langs = useMemo(
    () =>
      LANGUAGES.filter((l) => l.code !== "en")
        .map((l) => ({ value: l.code, label: l.name, en: l.label, flag: l.flag }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [],
  );

  const { ordered, prioCount } = useMemo(() => {
    const seen = new Set<string>();
    const prio: typeof langs = [];
    for (const code of PRIORITY) {
      const m = langs.find((l) => l.value === code);
      if (m && !seen.has(m.value)) {
        prio.push(m);
        seen.add(m.value);
      }
    }
    const rest = langs.filter((l) => !seen.has(l.value));
    return { ordered: [...prio, ...rest], prioCount: prio.length };
  }, [langs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter(
      (l) =>
        l.label.toLowerCase().includes(q) ||
        l.en.toLowerCase().includes(q) ||
        l.value.toLowerCase().includes(q),
    );
  }, [ordered, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(id);
  }, [open]);

  const toggleOpen = () => {
    if (!open) {
      setQuery("");
      setActive(0);
    }
    setOpen((o) => !o);
  };

  const apply = (code: string) => {
    setOpen(false);
    setLang(code);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[active]) apply(filtered[active].value);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="langsw">
      <button
        type="button"
        className="langsw-btn"
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t("Languages")}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
        </svg>
        <span className="langsw-flag" aria-hidden>{current.flag}</span>
        <span className="langsw-name">{current.name}</span>
        <span className="langsw-count">{total}+</span>
        <svg className="langsw-caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="langsw-pop" role="listbox">
          <input
            ref={inputRef}
            className="langsw-search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("Search language…")}
          />
          <ul className="langsw-list">
            <li>
              <button
                type="button"
                className={`langsw-item${lang === "en" ? " current" : ""}`}
                onClick={() => apply("en")}
              >
                <span className="langsw-item-flag" aria-hidden>🇺🇸</span>
                <span className="langsw-item-label">{t("English (original)")}</span>
              </button>
            </li>
            {filtered.map((l, i) => (
              <React.Fragment key={l.value}>
                {!query && prioCount > 0 && i === prioCount && (
                  <li className="langsw-sep" aria-hidden />
                )}
                <li>
                  <button
                    type="button"
                    className={`langsw-item${lang === l.value ? " current" : ""}${i === active ? " active" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => apply(l.value)}
                  >
                    <span className="langsw-item-flag" aria-hidden>{l.flag}</span>
                    <span className="langsw-item-label">{l.label}</span>
                  </button>
                </li>
              </React.Fragment>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
