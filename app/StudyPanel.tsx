"use client";

import { useEffect, useState } from "react";
import { getLanguage } from "@/lib/languages";
import { useT, useUiLang } from "@/lib/i18n";
import { useSpeech } from "@/lib/useSpeech";
import {
  useStudy,
  vocabKey,
  grammarKey,
  type StudyLine,
  type VocabItem,
  type GrammarItem,
} from "@/lib/useStudy";

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
              {study.savedVocab.length === 0 ? (
                <p className="study-empty">
                  {tx(
                    "Keep talking and words will collect here automatically (when Auto-collect is ON). You can also add them by hand from “Learn from conversation”.",
                  )}
                </p>
              ) : (
                study.savedVocab.map((v) => {
                  const key = vocabKey(v);
                  const hidden = review && !revealed.has(key);
                  return (
                    <VocabCard
                      key={key}
                      item={v}
                      speech={speech}
                      hiddenMeaning={hidden}
                      onToggle={() => review && toggleReveal(key)}
                      saved
                      onRemove={() => study.removeVocab(key)}
                    />
                  );
                })
              )}
            </div>
          )}

          {tab === "grammar" && (
            <div className="study-list">
              {study.savedGrammar.length === 0 ? (
                <p className="study-empty">
                  {tx(
                    "Keep talking and grammar points will collect here automatically (when Auto-collect is ON). You can also add them by hand from “Learn from conversation”.",
                  )}
                </p>
              ) : (
                study.savedGrammar.map((g) => {
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
}: {
  item: VocabItem;
  speech: Speech;
  saved?: boolean;
  onSave?: () => void;
  onRemove?: () => void;
  hiddenMeaning?: boolean;
  onToggle?: () => void;
}) {
  const tx = useT();
  const flag = getLanguage(item.lang).flag;
  const spKey = `vocab:${vocabKey(item)}`;
  const playing = speech.playingKey === spKey;
  return (
    <div className="vcard" onClick={onToggle}>
      <div className="vcard-top">
        <span className="vcard-flag" aria-hidden>
          {flag}
        </span>
        <span className="vcard-term">{item.term}</span>
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
      {item.example && !hiddenMeaning && (
        <p className="vcard-example">“{item.example}”</p>
      )}
      {item.exampleLocal && !hiddenMeaning && (
        <p className="vcard-example-local">{item.exampleLocal}</p>
      )}
    </div>
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
      {item.example && <p className="gcard-example">“{item.example}”</p>}
      {item.exampleLocal && (
        <p className="gcard-example-local">{item.exampleLocal}</p>
      )}
    </div>
  );
}
