"use client";

import { useEffect, useState } from "react";
import { getLanguage } from "@/lib/languages";
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
}: {
  open: boolean;
  onClose: () => void;
  study: Study;
  speech: Speech;
  lines: StudyLine[];
}) {
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

  const savedVocabKeys = new Set(study.savedVocab.map(vocabKey));
  const savedGrammarKeys = new Set(study.savedGrammar.map(grammarKey));

  return (
    <div className="study-overlay" role="dialog" aria-modal="true">
      <div className="study-backdrop" onClick={onClose} />
      <div className="study-sheet">
        <header className="study-head">
          <h2 className="study-title">📚 学習</h2>
          <button className="study-close" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </header>

        <div className="study-tabs">
          <button
            className={`study-tab${tab === "learn" ? " on" : ""}`}
            onClick={() => setTab("learn")}
          >
            会話から学ぶ
          </button>
          <button
            className={`study-tab${tab === "vocab" ? " on" : ""}`}
            onClick={() => setTab("vocab")}
          >
            単語帳{study.savedVocab.length ? ` (${study.savedVocab.length})` : ""}
          </button>
          <button
            className={`study-tab${tab === "grammar" ? " on" : ""}`}
            onClick={() => setTab("grammar")}
          >
            文法ノート
            {study.savedGrammar.length ? ` (${study.savedGrammar.length})` : ""}
          </button>
        </div>

        <div className="study-body">
          {tab === "learn" && (
            <LearnTab
              study={study}
              speech={speech}
              lines={lines}
              savedVocabKeys={savedVocabKeys}
              savedGrammarKeys={savedGrammarKeys}
            />
          )}

          {tab === "vocab" && (
            <div className="study-list">
              <div className="study-listhead">
                <span>{study.savedVocab.length} 語</span>
                {study.savedVocab.length > 0 && (
                  <button
                    className={`study-review${review ? " on" : ""}`}
                    onClick={() => {
                      setReview((v) => !v);
                      setRevealed(new Set());
                    }}
                  >
                    {review ? "✓ 復習モード" : "復習モード（意味を隠す）"}
                  </button>
                )}
              </div>
              {study.savedVocab.length === 0 ? (
                <p className="study-empty">
                  「会話から学ぶ」で単語を生成して、＋で保存するとここに貯まります。
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
                  「会話から学ぶ」で文法を生成して、＋で保存するとここに貯まります。
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
  savedVocabKeys,
  savedGrammarKeys,
}: {
  study: Study;
  speech: Speech;
  lines: StudyLine[];
  savedVocabKeys: Set<string>;
  savedGrammarKeys: Set<string>;
}) {
  const gen = study.generated;
  const canGenerate = lines.length > 0;
  return (
    <div className="study-list">
      <button
        className="study-generate"
        onClick={() => study.generate(lines)}
        disabled={study.generating || !canGenerate}
      >
        {study.generating
          ? "✨ 生成中…"
          : gen
            ? "🔄 この会話からもう一度生成"
            : "✨ この会話から単語・文法を生成"}
      </button>
      {!canGenerate && (
        <p className="study-empty">
          まだ会話がありません。少し話してから生成してください。
        </p>
      )}
      {study.error && <p className="study-error">{study.error}</p>}

      {gen && (
        <>
          <h3 className="study-section">単語・フレーズ</h3>
          {gen.vocab.length === 0 ? (
            <p className="study-empty">抽出できる単語がありませんでした。</p>
          ) : (
            gen.vocab.map((v) => {
              const key = vocabKey(v);
              return (
                <VocabCard
                  key={key}
                  item={v}
                  speech={speech}
                  saved={savedVocabKeys.has(key)}
                  onSave={() => study.saveVocab(v)}
                />
              );
            })
          )}

          <h3 className="study-section">文法ポイント</h3>
          {gen.grammar.length === 0 ? (
            <p className="study-empty">抽出できる文法がありませんでした。</p>
          ) : (
            gen.grammar.map((g) => {
              const key = grammarKey(g);
              return (
                <GrammarCard
                  key={key}
                  item={g}
                  saved={savedGrammarKeys.has(key)}
                  onSave={() => study.saveGrammar(g)}
                />
              );
            })
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
        <button
          type="button"
          className={`speak-btn${playing ? " playing" : ""}`}
          aria-label="読み上げ"
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
              {saved ? "✓ 保存済み" : "＋ 単語帳"}
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
              aria-label="削除"
            >
              🗑
            </button>
          )}
        </div>
      </div>
      {item.reading && <p className="vcard-reading">{item.reading}</p>}
      {hiddenMeaning ? (
        <p className="vcard-meaning hidden">タップして意味を表示</p>
      ) : (
        <p className="vcard-meaning">{item.meaning}</p>
      )}
      {item.example && !hiddenMeaning && (
        <p className="vcard-example">“{item.example}”</p>
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
  const flag = getLanguage(item.lang).flag;
  return (
    <div className="gcard">
      <div className="gcard-top">
        <span className="gcard-flag" aria-hidden>
          {flag}
        </span>
        <span className="gcard-title">{item.title}</span>
        <div className="vcard-actions">
          {onSave && (
            <button
              type="button"
              className={`study-save${saved ? " saved" : ""}`}
              onClick={() => !saved && onSave()}
            >
              {saved ? "✓ 保存済み" : "＋ ノート"}
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              className="study-remove"
              onClick={onRemove}
              aria-label="削除"
            >
              🗑
            </button>
          )}
        </div>
      </div>
      <p className="gcard-exp">{item.explanation}</p>
      {item.example && <p className="gcard-example">“{item.example}”</p>}
    </div>
  );
}
