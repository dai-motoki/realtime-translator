"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getLanguage, LANGUAGES } from "@/lib/languages";
import { useT, useUiLang } from "@/lib/i18n";
import { useSpeech } from "@/lib/useSpeech";
import {
  useStudy,
  vocabKey,
  grammarKey,
  exampleList,
  sortForLearning,
  type StudyLine,
  type VocabItem,
  type GrammarItem,
} from "@/lib/useStudy";

// Languages present in a list, ordered the same way the picker orders them.
const LANG_ORDER = new Map(LANGUAGES.map((l, i) => [l.code, i]));
function langsIn(items: { lang: string }[]): string[] {
  const set = new Set<string>();
  for (const it of items) if (it.lang) set.add(it.lang);
  return [...set].sort(
    (a, b) => (LANG_ORDER.get(a) ?? 999) - (LANG_ORDER.get(b) ?? 999),
  );
}

type Study = ReturnType<typeof useStudy>;
type Speech = ReturnType<typeof useSpeech>;
type Tab = "learn" | "vocab" | "grammar";

export function StudyPanel({
  open,
  onClose,
  study,
  speech,
  lines,
  auto,
  onToggleAuto,
}: {
  open: boolean;
  onClose: () => void;
  study: Study;
  speech: Speech;
  lines: StudyLine[];
  auto: boolean;
  onToggleAuto: () => void;
}) {
  const tx = useT();
  const [tab, setTab] = useState<Tab>("learn");
  // Flashcard-style review: hide meanings until each card is tapped.
  const [review, setReview] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  // Language filters for the saved lists ("all" = no filter).
  const [vocabLang, setVocabLang] = useState("all");
  const [grammarLang, setGrammarLang] = useState("all");

  // Close on Escape for desktop use.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const toggleReveal = (key: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="study-overlay" role="dialog" aria-modal="true">
      <div className="study-backdrop" onClick={onClose} />
      <div className="study-sheet">
        <header className="study-head">
          <h2 className="study-title">
            📚 {tx("Study")}
            {study.accumulating && (
              <span
                className="study-accum"
                title={tx("Adding from the conversation automatically")}
              >
                ✨ {tx("Adding…")}
              </span>
            )}
          </h2>
          <div className="study-head-right">
            <button
              className={`study-auto${auto ? " on" : ""}`}
              onClick={onToggleAuto}
              aria-pressed={auto}
              title={tx("Automatically add words and grammar from the conversation")}
            >
              {tx("Auto-collect")} {auto ? "ON" : "OFF"}
            </button>
            <button
              className="study-close"
              onClick={onClose}
              aria-label={tx("Close")}
            >
              ✕
            </button>
          </div>
        </header>

        <div className="study-tabs">
          <button
            className={`study-tab${tab === "learn" ? " on" : ""}`}
            onClick={() => setTab("learn")}
          >
            {tx("Learn from conversation")}
          </button>
          <button
            className={`study-tab${tab === "vocab" ? " on" : ""}`}
            onClick={() => setTab("vocab")}
          >
            {tx("Vocabulary")}
            {study.savedVocab.length ? ` (${study.savedVocab.length})` : ""}
          </button>
          <button
            className={`study-tab${tab === "grammar" ? " on" : ""}`}
            onClick={() => setTab("grammar")}
          >
            {tx("Grammar notes")}
            {study.savedGrammar.length ? ` (${study.savedGrammar.length})` : ""}
          </button>
        </div>

        <div className="study-body">
          {tab === "learn" && (
            <LearnTab study={study} speech={speech} lines={lines} />
          )}

          {tab === "vocab" && (
            <div className="study-list">
              <div className="study-listhead">
                <span>
                  {study.savedVocab.length} {tx("words")}
                </span>
                {study.savedVocab.length > 0 && (
                  <button
                    className={`study-review${review ? " on" : ""}`}
                    onClick={() => {
                      setReview((v) => !v);
                      setRevealed(new Set());
                    }}
                  >
                    {review
                      ? `✓ ${tx("Review mode")}`
                      : tx("Review mode (hide meanings)")}
                  </button>
                )}
              </div>
              <LangFilter
                langs={langsIn(study.savedVocab)}
                value={vocabLang}
                onChange={setVocabLang}
              />
              {study.savedVocab.length === 0 ? (
                <p className="study-empty">
                  {tx(
                    "Keep talking and words will collect here automatically (when Auto-collect is ON). You can also add them by hand from “Learn from conversation”.",
                  )}
                </p>
              ) : (
                <SavedVocabList
                  study={study}
                  speech={speech}
                  langFilter={vocabLang}
                  review={review}
                  revealed={revealed}
                  onToggleReveal={toggleReveal}
                />
              )}
            </div>
          )}

          {tab === "grammar" && (
            <div className="study-list">
              <LangFilter
                langs={langsIn(study.savedGrammar)}
                value={grammarLang}
                onChange={setGrammarLang}
              />
              {study.savedGrammar.length === 0 ? (
                <p className="study-empty">
                  {tx(
                    "Keep talking and grammar points will collect here automatically (when Auto-collect is ON). You can also add them by hand from “Learn from conversation”.",
                  )}
                </p>
              ) : (
                study.savedGrammar
                  .filter(
                    (g) => grammarLang === "all" || g.lang === grammarLang,
                  )
                  .map((g) => {
                    const key = grammarKey(g);
                    return (
                      <GrammarCard
                        key={key}
                        item={g}
                        saved
                        onRemove={() => study.removeGrammar(key)}
                      />
                    );
                  })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// A row of language chips for filtering a saved list. Hidden when there's only
// one (or no) language present, since there's nothing to filter.
function LangFilter({
  langs,
  value,
  onChange,
}: {
  langs: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const tx = useT();
  if (langs.length <= 1) return null;
  return (
    <div className="study-langfilter">
      <button
        type="button"
        className={`lf-chip${value === "all" ? " on" : ""}`}
        onClick={() => onChange("all")}
      >
        🌐 {tx("All")}
      </button>
      {langs.map((code) => {
        const l = getLanguage(code);
        return (
          <button
            key={code}
            type="button"
            className={`lf-chip${value === code ? " on" : ""}`}
            onClick={() => onChange(code)}
          >
            {l.flag} {l.name}
          </button>
        );
      })}
    </div>
  );
}

// Accumulates how long a card stays in view (≥60% visible) and reports it, so
// the learning sort can rank words by how long you dwelt on them.
function useDwell(
  key: string,
  flush: (key: string, ms: number) => void,
): (el: HTMLDivElement | null) => void {
  const elRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<number | null>(null);
  const setRef = (el: HTMLDivElement | null) => {
    elRef.current = el;
  };
  useEffect(() => {
    const el = elRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const commit = () => {
      if (startRef.current != null) {
        flush(key, Date.now() - startRef.current);
        startRef.current = null;
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) {
            startRef.current ??= Date.now();
          } else {
            commit();
          }
        }
      },
      { threshold: [0, 0.6, 1] },
    );
    io.observe(el);
    const onVis = () => {
      if (document.hidden) commit();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      commit();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [key, flush]);
  return setRef;
}

// Card with dwell tracking; one per saved word.
function TrackedVocabCard({
  item,
  speech,
  hiddenMeaning,
  onToggle,
  onRemove,
  onDwell,
}: {
  item: VocabItem;
  speech: Speech;
  hiddenMeaning: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onDwell: (key: string, ms: number) => void;
}) {
  const key = vocabKey(item);
  const cardRef = useDwell(key, onDwell);
  return (
    <VocabCard
      item={item}
      speech={speech}
      hiddenMeaning={hiddenMeaning}
      onToggle={onToggle}
      saved
      showStatus
      onRemove={onRemove}
      cardRef={cardRef}
    />
  );
}

// The saved Vocabulary list, ordered for learning: unseen words first, then the
// ones you dwelt on longest. The order is frozen while you read (it only
// recomputes when the set of words or the language filter changes) so cards
// don't jump as dwell times tick up.
function SavedVocabList({
  study,
  speech,
  langFilter,
  review,
  revealed,
  onToggleReveal,
}: {
  study: Study;
  speech: Speech;
  langFilter: string;
  review: boolean;
  revealed: Set<string>;
  onToggleReveal: (key: string) => void;
}) {
  const tx = useT();
  const filtered = useMemo(
    () =>
      study.savedVocab.filter(
        (v) => langFilter === "all" || v.lang === langFilter,
      ),
    [study.savedVocab, langFilter],
  );

  const keySig = filtered.map(vocabKey).join("|");
  const [orderedKeys, setOrderedKeys] = useState<string[]>([]);
  // Keep the latest list available to the resort effect without making it a
  // dependency, so dwell ticks don't re-trigger (and reorder) the list.
  const filteredRef = useRef(filtered);
  useEffect(() => {
    filteredRef.current = filtered;
  });
  useEffect(() => {
    setOrderedKeys(sortForLearning(filteredRef.current).map(vocabKey));
  }, [keySig]);

  const display = useMemo(() => {
    const byKey = new Map(filtered.map((v) => [vocabKey(v), v]));
    const known = new Set(orderedKeys);
    const inOrder = orderedKeys
      .map((k) => byKey.get(k))
      .filter((v): v is VocabItem => !!v);
    const extras = filtered.filter((v) => !known.has(vocabKey(v)));
    return [...inOrder, ...extras];
  }, [filtered, orderedKeys]);

  if (display.length === 0) {
    return <p className="study-empty">{tx("No words in this language yet.")}</p>;
  }
  return (
    <>
      {display.map((v) => {
        const key = vocabKey(v);
        const hidden = review && !revealed.has(key);
        return (
          <TrackedVocabCard
            key={key}
            item={v}
            speech={speech}
            hiddenMeaning={hidden}
            onToggle={() => review && onToggleReveal(key)}
            onRemove={() => study.removeVocab(key)}
            onDwell={study.addVocabDwell}
          />
        );
      })}
    </>
  );
}

function LearnTab({
  study,
  speech,
  lines,
}: {
  study: Study;
  speech: Speech;
  lines: StudyLine[];
}) {
  const tx = useT();
  const uiLang = useUiLang();
  const gen = study.generated;
  const canGenerate = lines.length > 0;
  return (
    <div className="study-list">
      <button
        className="study-generate"
        onClick={() => study.generate(lines, uiLang)}
        disabled={study.generating || !canGenerate}
      >
        {study.generating
          ? `✨ ${tx("Generating…")}`
          : gen
            ? `🔄 ${tx("Generate again from this conversation")}`
            : `✨ ${tx("Generate words & grammar from this conversation")}`}
      </button>
      {!canGenerate && (
        <p className="study-empty">
          {tx("No conversation yet. Talk a little, then generate.")}
        </p>
      )}
      {study.error && <p className="study-error">{tx(study.error)}</p>}

      {gen && (
        <>
          <h3 className="study-section">{tx("Words & phrases")}</h3>
          {gen.vocab.length === 0 ? (
            <p className="study-empty">{tx("No words could be extracted.")}</p>
          ) : (
            gen.vocab.map((v) => (
              <VocabCard
                key={vocabKey(v)}
                item={v}
                speech={speech}
                saved={study.hasVocab(v)}
                onSave={() => study.saveVocab(v)}
              />
            ))
          )}

          <h3 className="study-section">{tx("Grammar points")}</h3>
          {gen.grammar.length === 0 ? (
            <p className="study-empty">{tx("No grammar could be extracted.")}</p>
          ) : (
            gen.grammar.map((g) => (
              <GrammarCard
                key={grammarKey(g)}
                item={g}
                saved={study.hasGrammar(g)}
                onSave={() => study.saveGrammar(g)}
              />
            ))
          )}
        </>
      )}
    </div>
  );
}

function VocabCard({
  item,
  speech,
  saved,
  onSave,
  onRemove,
  hiddenMeaning,
  onToggle,
  showStatus,
  cardRef,
}: {
  item: VocabItem;
  speech: Speech;
  saved?: boolean;
  onSave?: () => void;
  onRemove?: () => void;
  hiddenMeaning?: boolean;
  onToggle?: () => void;
  /** Show the "not reviewed yet" marker (saved list only). */
  showStatus?: boolean;
  cardRef?: (el: HTMLDivElement | null) => void;
}) {
  const tx = useT();
  const flag = getLanguage(item.lang).flag;
  const spKey = `vocab:${vocabKey(item)}`;
  const playing = speech.playingKey === spKey;
  return (
    <div className="vcard" onClick={onToggle} ref={cardRef}>
      <div className="vcard-top">
        <span className="vcard-flag" aria-hidden>
          {flag}
        </span>
        <span className="vcard-term">{item.term}</span>
        {showStatus && !item.seen && (
          <span className="study-new" title={tx("Not reviewed yet")}>
            {tx("New")}
          </span>
        )}
        {(item.count ?? 1) > 1 && (
          <span
            className="study-times"
            title={tx("Appeared {n} times").replace("{n}", String(item.count))}
          >
            ×{item.count}
          </span>
        )}
        <button
          type="button"
          className={`speak-btn${playing ? " playing" : ""}`}
          aria-label={tx("Read aloud")}
          onClick={(e) => {
            e.stopPropagation();
            speech.speak(spKey, item.term, item.lang);
          }}
        >
          {speech.loadingKey === spKey ? "…" : playing ? "⏸" : "🔊"}
        </button>
        <div className="vcard-actions">
          {onSave && (
            <button
              type="button"
              className={`study-save${saved ? " saved" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                if (!saved) onSave();
              }}
            >
              {saved ? `✓ ${tx("Saved")}` : `＋ ${tx("Vocabulary")}`}
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              className="study-remove"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              aria-label={tx("Delete")}
            >
              🗑
            </button>
          )}
        </div>
      </div>
      {item.reading && <p className="vcard-reading">{item.reading}</p>}
      {hiddenMeaning ? (
        <p className="vcard-meaning hidden">{tx("Tap to show the meaning")}</p>
      ) : (
        <p className="vcard-meaning">{item.meaning}</p>
      )}
      {!hiddenMeaning && <Examples item={item} />}
    </div>
  );
}

// Renders every example sentence kept for an item, each paired with its own
// translation so the original and the translation always stay in sync.
function Examples({
  item,
  variant = "vcard",
}: {
  item: VocabItem | GrammarItem;
  variant?: "vcard" | "gcard";
}) {
  const examples = exampleList(item);
  if (examples.length === 0) return null;
  return (
    <>
      {examples.map((ex, i) => (
        <div className="study-ex" key={i}>
          <p className={`${variant}-example`}>“{ex.text}”</p>
          {ex.local && <p className={`${variant}-example-local`}>{ex.local}</p>}
        </div>
      ))}
    </>
  );
}

function GrammarCard({
  item,
  saved,
  onSave,
  onRemove,
}: {
  item: GrammarItem;
  saved?: boolean;
  onSave?: () => void;
  onRemove?: () => void;
}) {
  const tx = useT();
  const flag = getLanguage(item.lang).flag;
  return (
    <div className="gcard">
      <div className="gcard-top">
        <span className="gcard-flag" aria-hidden>
          {flag}
        </span>
        <span className="gcard-title">{item.title}</span>
        {(item.count ?? 1) > 1 && (
          <span
            className="study-times"
            title={tx("Appeared {n} times").replace("{n}", String(item.count))}
          >
            ×{item.count}
          </span>
        )}
        <div className="vcard-actions">
          {onSave && (
            <button
              type="button"
              className={`study-save${saved ? " saved" : ""}`}
              onClick={() => !saved && onSave()}
            >
              {saved ? `✓ ${tx("Saved")}` : `＋ ${tx("Notes")}`}
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              className="study-remove"
              onClick={onRemove}
              aria-label={tx("Delete")}
            >
              🗑
            </button>
          )}
        </div>
      </div>
      <p className="gcard-exp">{item.explanation}</p>
      <Examples item={item} variant="gcard" />
    </div>
  );
}
