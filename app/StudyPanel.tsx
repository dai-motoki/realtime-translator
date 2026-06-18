"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { getLanguage, LANGUAGES } from "@/lib/languages";
import { useT, useUiLang } from "@/lib/i18n";
import { useSpeech } from "@/lib/useSpeech";
import {
  ensureEmbeddings,
  getEmbedding,
  useEmbeddingsVersion,
} from "@/lib/embeddings";
import {
  useStudy,
  vocabKey,
  grammarKey,
  exampleList,
  groupForLearning,
  searchItems,
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
  const uiLang = useUiLang();
  // Generate a memory hook for one word on demand (per-card button).
  const generateMnemonic = useCallback(
    async (item: VocabItem) => {
      try {
        const res = await fetch("/api/mnemonic", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            term: item.term,
            reading: item.reading,
            meaning: item.meaning,
            example: exampleList(item)[0]?.text,
            lang: uiLang,
          }),
        });
        const data = (await res.json().catch(() => null)) as {
          mnemonic?: string;
        } | null;
        if (data?.mnemonic) study.setVocabMnemonic(vocabKey(item), data.mnemonic);
      } catch {
        // network error — leave the card as-is
      }
    },
    [study, uiLang],
  );
  // Default to the saved word list when Auto-collect is ON (the manual "learn"
  // tab is hidden in that case).
  const [tab, setTab] = useState<Tab>(auto ? "vocab" : "learn");
  // Flashcard-style review: hide meanings until each card is tapped.
  const [review, setReview] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  // Language filters for the saved lists ("all" = no filter).
  const [vocabLang, setVocabLang] = useState("all");
  const [grammarLang, setGrammarLang] = useState("all");
  // Smart search queries for the saved lists ("" = browse mode).
  const [vocabQuery, setVocabQuery] = useState("");
  const [grammarQuery, setGrammarQuery] = useState("");

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
              {study.savedVocab.length > 0 && (
                <SearchBox
                  value={vocabQuery}
                  onChange={setVocabQuery}
                  placeholder={tx("Search words (any language)…")}
                />
              )}
              {study.savedVocab.length === 0 ? (
                <p className="study-empty">
                  {tx(
                    "Keep talking and words will collect here automatically (when Auto-collect is ON). You can also add them by hand from “Learn from conversation”.",
                  )}
                </p>
              ) : vocabQuery.trim() ? (
                <SearchResults
                  items={study.savedVocab}
                  langFilter={vocabLang}
                  query={vocabQuery}
                  keyOf={vocabKey}
                  textOf={(v) => v.term}
                  haystackOf={vocabHaystack}
                  emptyText={tx("No matches.")}
                  renderCard={(v) => {
                    const key = vocabKey(v);
                    return (
                      <VocabCard
                        item={v}
                        speech={speech}
                        saved
                        onRemove={() => study.removeVocab(key)}
                        onMnemonic={() => generateMnemonic(v)}
                      />
                    );
                  }}
                />
              ) : (
                <SavedDeck
                  key={vocabLang}
                  items={study.savedVocab}
                  langFilter={vocabLang}
                  keyOf={vocabKey}
                  textOf={(v) => v.term}
                  onDwell={study.addVocabDwell}
                  emptyText={tx("No words in this language yet.")}
                  groupLabel={tx("Related words")}
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
                        onMnemonic={() => generateMnemonic(v)}
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
              {study.savedGrammar.length > 0 && (
                <SearchBox
                  value={grammarQuery}
                  onChange={setGrammarQuery}
                  placeholder={tx("Search grammar (any language)…")}
                />
              )}
              {study.savedGrammar.length === 0 ? (
                <p className="study-empty">
                  {tx(
                    "Keep talking and grammar points will collect here automatically (when Auto-collect is ON). You can also add them by hand from “Learn from conversation”.",
                  )}
                </p>
              ) : grammarQuery.trim() ? (
                <SearchResults
                  items={study.savedGrammar}
                  langFilter={grammarLang}
                  query={grammarQuery}
                  keyOf={grammarKey}
                  textOf={(g) => g.title}
                  haystackOf={grammarHaystack}
                  emptyText={tx("No matches.")}
                  renderCard={(g) => (
                    <GrammarCard
                      item={g}
                      speech={speech}
                      saved
                      onRemove={() => study.removeGrammar(grammarKey(g))}
                    />
                  )}
                />
              ) : (
                <SavedDeck
                  key={grammarLang}
                  items={study.savedGrammar}
                  langFilter={grammarLang}
                  keyOf={grammarKey}
                  textOf={(g) => g.title}
                  onDwell={study.addGrammarDwell}
                  emptyText={tx("No grammar points in this language yet.")}
                  groupLabel={tx("Related notes")}
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

// Searchable text blobs for each card type (term/reading/meaning/examples …).
const vocabHaystack = (v: VocabItem): string =>
  [
    v.term,
    v.reading,
    v.meaning,
    v.mnemonic ?? "",
    exampleList(v)
      .map((e) => `${e.text} ${e.local ?? ""}`)
      .join(" "),
  ].join(" ");
const grammarHaystack = (g: GrammarItem): string =>
  [
    g.title,
    g.explanation,
    exampleList(g)
      .map((e) => `${e.text} ${e.local ?? ""}`)
      .join(" "),
  ].join(" ");

// Search box for the saved lists, with a clear button.
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const tx = useT();
  return (
    <div className="study-search">
      <span className="study-search-icon" aria-hidden>
        🔍
      </span>
      <input
        type="search"
        className="study-search-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          className="study-search-clear"
          aria-label={tx("Clear")}
          onClick={() => onChange("")}
        >
          ✕
        </button>
      )}
    </div>
  );
}

// Smart (lexical + semantic) search results for a saved list, ranked by
// relevance. Results aren't dwell-tracked, so they render as a plain list.
function SearchResults<T extends { lang: string }>({
  items,
  langFilter,
  query,
  keyOf,
  textOf,
  haystackOf,
  emptyText,
  renderCard,
}: {
  items: T[];
  langFilter: string;
  query: string;
  keyOf: (item: T) => string;
  textOf: (item: T) => string;
  haystackOf: (item: T) => string;
  emptyText: string;
  renderCard: (item: T) => ReactNode;
}) {
  const filtered = useMemo(
    () => items.filter((it) => langFilter === "all" || it.lang === langFilter),
    [items, langFilter],
  );

  // Debounce so we don't embed/search on every keystroke.
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), 200);
    return () => window.clearTimeout(id);
  }, [query]);

  const embVersion = useEmbeddingsVersion();
  const filteredRef = useRef(filtered);
  const textOfRef = useRef(textOf);
  useEffect(() => {
    filteredRef.current = filtered;
    textOfRef.current = textOf;
  });
  // Make sure the query and the cards both have embeddings for semantic search.
  useEffect(() => {
    const q = debounced.trim();
    if (!q) return;
    void ensureEmbeddings([q, ...filteredRef.current.map(textOfRef.current)]);
  }, [debounced]);

  const results = useMemo(
    () => searchItems(filtered, debounced, textOf, haystackOf, getEmbedding),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, debounced, embVersion],
  );

  if (!debounced.trim()) return null;
  if (results.length === 0) {
    return <p className="study-empty">{emptyText}</p>;
  }
  // Cap how many result cards render at once (keeps large libraries snappy).
  const shown = results.slice(0, 50);
  return (
    <div className="study-results">
      {shown.map((it) => (
        <Fragment key={keyOf(it)}>{renderCard(it)}</Fragment>
      ))}
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
  groupLabel,
  renderCard,
}: {
  items: T[];
  langFilter: string;
  keyOf: (item: T) => string;
  /** Text used to build the similarity graph for the learning ranking. */
  textOf: (item: T) => string;
  onDwell: (key: string, ms: number) => void;
  emptyText: string;
  /** Heading for a "feature" card that bundles several related items. */
  groupLabel: string;
  renderCard: (
    item: T,
    cardRef: (el: HTMLDivElement | null) => void,
  ) => ReactNode;
}) {
  const filtered = useMemo(
    () => items.filter((it) => langFilter === "all" || it.lang === langFilter),
    [items, langFilter],
  );

  // Dwell on a feature card credits all its members (split evenly, so a group
  // isn't over-weighted versus a single card).
  const memberMapRef = useRef<Map<string, string[]>>(new Map());
  const onDwellRef = useRef(onDwell);
  useEffect(() => {
    onDwellRef.current = onDwell;
  });
  const distribute = useCallback((groupKey: string, ms: number) => {
    const members = memberMapRef.current.get(groupKey) ?? [groupKey];
    const share = ms / members.length;
    for (const k of members) onDwellRef.current(k, share);
  }, []);
  const { deckRef, cardRef } = useDeckDwell(distribute);

  const embVersion = useEmbeddingsVersion();
  const keySig = filtered.map(keyOf).join("|");
  // Frozen display order: groups of item-keys (most groups are a single key).
  const [keyGroups, setKeyGroups] = useState<string[][]>([]);
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
  // Fetch semantic embeddings for the current cards; the ranking upgrades from
  // lexical to semantic similarity once they arrive (bumping embVersion).
  useEffect(() => {
    void ensureEmbeddings(filteredRef.current.map(textOfRef.current));
  }, [keySig]);
  // Re-rank/-group when the set/filter changes or new embeddings land.
  useEffect(() => {
    const groups = groupForLearning(
      filteredRef.current,
      textOfRef.current,
      getEmbedding,
    ).map((g) => g.map(keyOfRef.current));
    setKeyGroups(groups);
  }, [keySig, embVersion]);

  // Resolve frozen key-groups against the current items; drop missing members,
  // append any brand-new items as their own singleton groups.
  const groups = useMemo(() => {
    const byKey = new Map(filtered.map((it) => [keyOf(it), it]));
    const used = new Set<string>();
    const out: T[][] = [];
    for (const grp of keyGroups) {
      const members = grp
        .map((k) => byKey.get(k))
        .filter((it): it is T => !!it);
      if (members.length) {
        out.push(members);
        for (const m of members) used.add(keyOf(m));
      }
    }
    for (const it of filtered) {
      if (!used.has(keyOf(it))) out.push([it]);
    }
    return out;
    // keyOf is stable per caller; excluded to avoid needless recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, keyGroups]);

  // Map each group's stable key → its member keys, for dwell distribution.
  const memberMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const grp of groups) {
      const keys = grp.map(keyOf);
      m.set(groupKeyOf(keys), keys);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);
  useEffect(() => {
    memberMapRef.current = memberMap;
  }, [memberMap]);

  // Render only a growing window of cards (each is ~full-screen, so rendering
  // hundreds at once can crash mobile browsers). Show more as you scroll near
  // the end; reset when the set/filter changes.
  // Reset of this window on language-filter change is handled by remounting the
  // deck (the caller passes key={langFilter}).
  const DECK_PAGE = 12;
  const [limit, setLimit] = useState(DECK_PAGE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const total = groups.length;
  useEffect(() => {
    if (limit >= total) return;
    const root = deckRef.current;
    const el = sentinelRef.current;
    if (!root || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLimit((l) => Math.min(total, l + DECK_PAGE));
        }
      },
      { root, rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [limit, total, deckRef]);

  if (groups.length === 0) {
    return <p className="study-empty">{emptyText}</p>;
  }
  const shown = groups.slice(0, limit);
  return (
    <div className="study-deck" ref={deckRef}>
      {shown.map((grp) => {
        const gKey = groupKeyOf(grp.map(keyOf));
        if (grp.length === 1) {
          return (
            <Fragment key={gKey}>{renderCard(grp[0], cardRef(gKey))}</Fragment>
          );
        }
        return (
          <div className="feature-card" key={gKey} ref={cardRef(gKey)}>
            <div className="feature-head">
              ✨ {groupLabel} <span className="feature-count">×{grp.length}</span>
            </div>
            <div className="feature-body">
              {grp.map((m) => (
                <Fragment key={keyOf(m)}>{renderCard(m, NOOP_REF)}</Fragment>
              ))}
            </div>
          </div>
        );
      })}
      {limit < total && <div ref={sentinelRef} className="study-deck-more" />}
    </div>
  );
}

const NOOP_REF = () => {};
// A stable key for a group from its (display-ordered) member keys.
const groupKeyOf = (keys: string[]) =>
  keys.length === 1 ? keys[0] : `feat:${keys.join("|")}`;

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
  onMnemonic,
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
  /** When provided, shows a button to generate/regenerate a memory hook. */
  onMnemonic?: () => Promise<void> | void;
  cardRef?: (el: HTMLDivElement | null) => void;
}) {
  const tx = useT();
  const flag = getLanguage(item.lang).flag;
  const spKey = `vocab:${vocabKey(item)}`;
  const playing = speech.playingKey === spKey;
  const [mnBusy, setMnBusy] = useState(false);
  const runMnemonic = async (e: ReactMouseEvent) => {
    e.stopPropagation();
    if (mnBusy || !onMnemonic) return;
    setMnBusy(true);
    try {
      await onMnemonic();
    } finally {
      setMnBusy(false);
    }
  };
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
      {!hiddenMeaning && item.mnemonic && (
        <p className="vcard-mnemonic">
          💡 {item.mnemonic}
          {onMnemonic && (
            <button
              type="button"
              className="vcard-mn-regen"
              onClick={runMnemonic}
              disabled={mnBusy}
              title={tx("Make another memory hook")}
            >
              {mnBusy ? "…" : "↻"}
            </button>
          )}
        </p>
      )}
      {!hiddenMeaning && !item.mnemonic && onMnemonic && (
        <button
          type="button"
          className="vcard-mn-gen"
          onClick={runMnemonic}
          disabled={mnBusy}
        >
          {mnBusy ? `✨ ${tx("Generating…")}` : `💡 ${tx("Make a memory hook")}`}
        </button>
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
            {ex.reading && <p className="study-ex-reading">{ex.reading}</p>}
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
