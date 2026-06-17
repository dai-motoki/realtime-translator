"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getLanguage, LANGUAGES } from "@/lib/languages";
import { useT, useUiLang } from "@/lib/i18n";
import { useSpeech } from "@/lib/useSpeech";
import {
  useStudy,
  vocabKey,
  grammarKey,
  exampleList,
  rankForLearning,
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
  // Default to the saved word list when Auto-collect is ON (the manual "learn"
  // tab is hidden in that case).
  const [tab, setTab] = useState<Tab>(auto ? "vocab" : "learn");
  // Flashcard-style review: hide meanings until each card is tapped.
  const [review, setReview] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  // Language filters for the saved lists ("all" = no filter).
  const [vocabLang, setVocabLang] = useState("all");
  const [grammarLang, setGrammarLang] = useState("all");

  // The "learn" tab is hidden while Auto-collect is ON; fall back to the word
  // list so the body is never blank (derived, so no extra render).
  const activeTab: Tab = auto && tab === "learn" ? "vocab" : tab;

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
          {/* With Auto-collect ON, words & grammar accumulate on their own, so
              the manual "Learn from conversation" tab is redundant — hide it. */}
          {!auto && (
            <button
              className={`study-tab${activeTab === "learn" ? " on" : ""}`}
              onClick={() => setTab("learn")}
            >
              {tx("Learn from conversation")}
            </button>
          )}
          <button
            className={`study-tab${activeTab === "vocab" ? " on" : ""}`}
            onClick={() => setTab("vocab")}
          >
            {tx("Vocabulary")}
            {study.savedVocab.length ? ` (${study.savedVocab.length})` : ""}
          </button>
          <button
            className={`study-tab${activeTab === "grammar" ? " on" : ""}`}
            onClick={() => setTab("grammar")}
          >
            {tx("Grammar notes")}
            {study.savedGrammar.length ? ` (${study.savedGrammar.length})` : ""}
          </button>
        </div>

        <div
          className={`study-body${activeTab === "vocab" || activeTab === "grammar" ? " deck-mode" : ""}`}
        >
          {activeTab === "learn" && (
            <LearnTab study={study} speech={speech} lines={lines} />
          )}

          {activeTab === "vocab" && (
            <div className="study-list study-list--deck">
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
                <SavedDeck
                  items={study.savedVocab}
                  langFilter={vocabLang}
                  keyOf={vocabKey}
                  textOf={(v) => v.term}
                  onDwell={study.addVocabDwell}
                  emptyText={tx("No words in this language yet.")}
                  renderCard={(v, cardRef) => {
                    const key = vocabKey(v);
                    const hidden = review && !revealed.has(key);
                    return (
                      <VocabCard
                        item={v}
                        speech={speech}
                        hiddenMeaning={hidden}
                        onToggle={() => review && toggleReveal(key)}
                        saved
                        showStatus
                        onRemove={() => study.removeVocab(key)}
                        cardRef={cardRef}
                      />
                    );
                  }}
                />
              )}
            </div>
          )}

          {activeTab === "grammar" && (
            <div className="study-list study-list--deck">
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
                <SavedDeck
                  items={study.savedGrammar}
                  langFilter={grammarLang}
                  keyOf={grammarKey}
                  textOf={(g) => g.title}
                  onDwell={study.addGrammarDwell}
                  emptyText={tx("No grammar points in this language yet.")}
                  renderCard={(g, cardRef) => (
                    <GrammarCard
                      item={g}
                      speech={speech}
                      saved
                      showStatus
                      onRemove={() => study.removeGrammar(grammarKey(g))}
                      cardRef={cardRef}
                    />
                  )}
                />
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
//
// Because the deck shows one card per screen (scroll-snap), exactly one card is
// "dominant" at a time. A single observer (rooted on the deck) tracks which card
// fills the screen and credits the time spent on it to that card alone, so the
// measurement isn't smeared across several visible cards.
function useDeckDwell(flush: (key: string, ms: number) => void) {
  const deckRef = useRef<HTMLDivElement | null>(null);
  const ioRef = useRef<IntersectionObserver | null>(null);
  const elsRef = useRef(new Map<string, HTMLElement>());
  const keyByEl = useRef(new WeakMap<Element, string>());
  const ratiosRef = useRef(new Map<string, number>());
  const activeRef = useRef<{ key: string; since: number } | null>(null);
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });

  const setActive = (key: string | null) => {
    const cur = activeRef.current;
    if (cur?.key === key) return;
    if (cur) flushRef.current(cur.key, Date.now() - cur.since);
    activeRef.current = key ? { key, since: Date.now() } : null;
  };

  const recompute = () => {
    let best: string | null = null;
    let bestR = 0;
    ratiosRef.current.forEach((r, k) => {
      if (r > bestR) {
        bestR = r;
        best = k;
      }
    });
    // A card counts once it covers at least half the deck (one card per screen).
    setActive(bestR >= 0.5 ? best : null);
  };

  useEffect(() => {
    const root = deckRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const key = keyByEl.current.get(e.target);
          if (key) ratiosRef.current.set(key, e.intersectionRatio);
        }
        recompute();
      },
      { root, threshold: [0, 0.5, 1] },
    );
    ioRef.current = io;
    for (const el of elsRef.current.values()) io.observe(el);
    const onVis = () => {
      if (document.hidden) setActive(null);
      else recompute();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      setActive(null);
      io.disconnect();
      ioRef.current = null;
      document.removeEventListener("visibilitychange", onVis);
    };
    // Mount once: flush is read through flushRef so it never needs to re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ref callback per card key: (un)observe its element as it mounts/unmounts.
  const cardRef = (key: string) => (el: HTMLDivElement | null) => {
    const old = elsRef.current.get(key);
    if (old && ioRef.current) ioRef.current.unobserve(old);
    if (el) {
      elsRef.current.set(key, el);
      keyByEl.current.set(el, key);
      ioRef.current?.observe(el);
    } else {
      elsRef.current.delete(key);
      ratiosRef.current.delete(key);
    }
  };

  return { deckRef, cardRef };
}

// A saved list shown as a one-card-per-screen snap deck, ordered for learning —
// items you haven't looked at yet first, then the ones you dwelt on longest. The
// order is frozen while you read (it only recomputes when the set of items or
// the language filter changes) so cards don't jump as dwell times tick up. Used
// for both the Vocabulary and Grammar lists.
function SavedDeck<
  T extends {
    lang: string;
    count?: number;
    at?: number;
    dwell?: number;
    seen?: boolean;
  },
>({
  items,
  langFilter,
  keyOf,
  textOf,
  onDwell,
  emptyText,
  renderCard,
}: {
  items: T[];
  langFilter: string;
  keyOf: (item: T) => string;
  /** Text used to build the similarity graph for the learning ranking. */
  textOf: (item: T) => string;
  onDwell: (key: string, ms: number) => void;
  emptyText: string;
  renderCard: (
    item: T,
    cardRef: (el: HTMLDivElement | null) => void,
  ) => ReactNode;
}) {
  const { deckRef, cardRef } = useDeckDwell(onDwell);
  const filtered = useMemo(
    () => items.filter((it) => langFilter === "all" || it.lang === langFilter),
    [items, langFilter],
  );

  const keySig = filtered.map(keyOf).join("|");
  const [orderedKeys, setOrderedKeys] = useState<string[]>([]);
  // Keep the latest list/accessors available to the resort effect without making
  // them dependencies, so dwell ticks don't re-trigger (and reorder) the list.
  const filteredRef = useRef(filtered);
  const keyOfRef = useRef(keyOf);
  const textOfRef = useRef(textOf);
  useEffect(() => {
    filteredRef.current = filtered;
    keyOfRef.current = keyOf;
    textOfRef.current = textOf;
  });
  useEffect(() => {
    setOrderedKeys(
      rankForLearning(filteredRef.current, textOfRef.current).map(
        keyOfRef.current,
      ),
    );
  }, [keySig]);

  const display = useMemo(() => {
    const byKey = new Map(filtered.map((it) => [keyOf(it), it]));
    const known = new Set(orderedKeys);
    const inOrder = orderedKeys
      .map((k) => byKey.get(k))
      .filter((it): it is T => !!it);
    const extras = filtered.filter((it) => !known.has(keyOf(it)));
    return [...inOrder, ...extras];
    // keyOf is stable per caller; excluded to avoid needless recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, orderedKeys]);

  if (display.length === 0) {
    return <p className="study-empty">{emptyText}</p>;
  }
  return (
    <div className="study-deck" ref={deckRef}>
      {display.map((it) => {
        const key = keyOf(it);
        return <Fragment key={key}>{renderCard(it, cardRef(key))}</Fragment>;
      })}
    </div>
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
                speech={speech}
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
      {!hiddenMeaning && (
        <Examples item={item} speech={speech} keyBase={spKey} />
      )}
    </div>
  );
}

// Renders every example sentence kept for an item, each paired with its own
// translation so the original and the translation always stay in sync. Each
// example's original-language line gets a speak button.
function Examples({
  item,
  speech,
  keyBase,
  variant = "vcard",
}: {
  item: VocabItem | GrammarItem;
  speech: Speech;
  keyBase: string;
  variant?: "vcard" | "gcard";
}) {
  const tx = useT();
  const examples = exampleList(item);
  if (examples.length === 0) return null;
  return (
    <>
      {examples.map((ex, i) => {
        const spKey = `${keyBase}:ex:${i}`;
        const playing = speech.playingKey === spKey;
        return (
          <div className="study-ex" key={i}>
            <div className="study-ex-line">
              <p className={`${variant}-example`}>“{ex.text}”</p>
              <button
                type="button"
                className={`speak-btn speak-btn--sm${playing ? " playing" : ""}`}
                aria-label={tx("Read aloud")}
                onClick={(e) => {
                  e.stopPropagation();
                  speech.speak(spKey, ex.text, item.lang);
                }}
              >
                {speech.loadingKey === spKey ? "…" : playing ? "⏸" : "🔊"}
              </button>
            </div>
            {ex.local && (
              <p className={`${variant}-example-local`}>{ex.local}</p>
            )}
          </div>
        );
      })}
    </>
  );
}

function GrammarCard({
  item,
  speech,
  saved,
  onSave,
  onRemove,
  showStatus,
  cardRef,
}: {
  item: GrammarItem;
  speech: Speech;
  saved?: boolean;
  onSave?: () => void;
  onRemove?: () => void;
  /** Show the "not reviewed yet" marker (saved list only). */
  showStatus?: boolean;
  cardRef?: (el: HTMLDivElement | null) => void;
}) {
  const tx = useT();
  const flag = getLanguage(item.lang).flag;
  return (
    <div className="gcard" ref={cardRef}>
      <div className="gcard-top">
        <span className="gcard-flag" aria-hidden>
          {flag}
        </span>
        <span className="gcard-title">{item.title}</span>
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
      <Examples
        item={item}
        speech={speech}
        keyBase={`grammar:${grammarKey(item)}`}
        variant="gcard"
      />
    </div>
  );
}
