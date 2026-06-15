"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LANGUAGES, getLanguage } from "@/lib/languages";
import { useTranslator } from "@/lib/useTranslator";

type Mode = "talk" | "live";
type Side = "A" | "B";

export default function Translator() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const t = useTranslator(audioRef);

  const [mode, setMode] = useState<Mode>("talk");

  // Conversation mode: A = your side, B = their side.
  const [langA, setLangA] = useState("ja");
  const [langB, setLangB] = useState("en");
  const [activeSide, setActiveSide] = useState<Side | null>(null);

  // Live mode: translate everything heard into this language.
  const [targetLang, setTargetLang] = useState("ja");

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the transcript as new content arrives.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [t.segments, t.partialSource, t.partialTarget]);

  // Keep the live-mode output language in sync when it changes mid-session.
  useEffect(() => {
    if (mode === "live" && t.status === "live") {
      t.setOutputLanguage(targetLang);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetLang]);

  const switchMode = useCallback(
    (next: Mode) => {
      if (next === mode) return;
      t.stop();
      setActiveSide(null);
      setMode(next);
    },
    [mode, t],
  );

  // ----- Conversation mode -----
  const onTalkSide = useCallback(
    async (side: Side) => {
      const other = side === "A" ? langB : langA;
      if (t.status === "idle" || t.status === "error") {
        setActiveSide(side);
        await t.start(other);
      } else if (activeSide === side) {
        // Tap the active side again to pause listening.
        t.setMuted(true);
        setActiveSide(null);
      } else {
        t.setOutputLanguage(other);
        t.setMuted(false);
        setActiveSide(side);
      }
    },
    [activeSide, langA, langB, t],
  );

  const swap = useCallback(() => {
    setLangA(langB);
    setLangB(langA);
  }, [langA, langB]);

  // ----- Live mode -----
  const onLiveToggle = useCallback(async () => {
    if (t.status === "idle" || t.status === "error") {
      await t.start(targetLang);
    } else {
      t.stop();
    }
  }, [t, targetLang]);

  const live = t.status === "live";
  const connecting = t.status === "connecting";

  return (
    <div className="app">
      <audio ref={audioRef} autoPlay playsInline />

      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" data-status={t.status} />
          <span className="brand-name">Realtime Translate</span>
        </div>
        <div className="seg">
          <button
            className={mode === "talk" ? "seg-btn on" : "seg-btn"}
            onClick={() => switchMode("talk")}
          >
            会話
          </button>
          <button
            className={mode === "live" ? "seg-btn on" : "seg-btn"}
            onClick={() => switchMode("live")}
          >
            ライブ
          </button>
        </div>
      </header>

      {t.error && (
        <div className="banner error" role="alert">
          {t.error}
        </div>
      )}

      {mode === "talk" ? (
        <LangBar
          langA={langA}
          langB={langB}
          onChangeA={setLangA}
          onChangeB={setLangB}
          onSwap={swap}
          disabled={live || connecting}
        />
      ) : (
        <LiveTargetBar value={targetLang} onChange={setTargetLang} />
      )}

      <main className="transcript" ref={scrollRef}>
        {mode === "talk" ? (
          <TalkTranscript
            segments={t.segments}
            langB={langB}
            partialSource={t.partialSource}
            partialTarget={t.partialTarget}
            activeSide={activeSide}
          />
        ) : (
          <LiveTranscript
            segments={t.segments}
            partialSource={t.partialSource}
            partialTarget={t.partialTarget}
            live={live}
          />
        )}
      </main>

      <footer className="controls">
        <div className="options">
          <button
            className={`audio-toggle ${t.audioOn ? "on" : ""}`}
            onClick={() => t.setAudioOn(!t.audioOn)}
            aria-pressed={t.audioOn}
          >
            <span className="audio-ico">{t.audioOn ? "🔊" : "🔇"}</span>
            音声出力 {t.audioOn ? "ON" : "OFF"}
          </button>
          {t.segments.length > 0 && (
            <button className="ghost" onClick={t.clear}>
              履歴を消す
            </button>
          )}
          {live && (
            <button className="ghost danger" onClick={t.stop}>
              終了
            </button>
          )}
        </div>

        {mode === "talk" ? (
          <div className="talk-controls">
            <TalkButton
              lang={langA}
              active={activeSide === "A"}
              speaking={t.speaking}
              busy={connecting}
              onClick={() => onTalkSide("A")}
            />
            <TalkButton
              lang={langB}
              active={activeSide === "B"}
              speaking={t.speaking}
              busy={connecting}
              onClick={() => onTalkSide("B")}
            />
          </div>
        ) : (
          <div className="live-controls">
            <button
              className={`record ${live ? "on" : ""}`}
              onClick={onLiveToggle}
              disabled={connecting}
            >
              <span className="record-icon" />
              {connecting ? "接続中…" : live ? "停止" : "翻訳をはじめる"}
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}

/* ---------------- Conversation language bar ---------------- */

function LangBar({
  langA,
  langB,
  onChangeA,
  onChangeB,
  onSwap,
  disabled,
}: {
  langA: string;
  langB: string;
  onChangeA: (v: string) => void;
  onChangeB: (v: string) => void;
  onSwap: () => void;
  disabled: boolean;
}) {
  return (
    <div className="langbar">
      <LangSelect
        value={langA}
        onChange={onChangeA}
        exclude={langB}
        disabled={disabled}
      />
      <button
        className="swap"
        onClick={onSwap}
        disabled={disabled}
        aria-label="言語を入れ替え"
      >
        ⇄
      </button>
      <LangSelect
        value={langB}
        onChange={onChangeB}
        exclude={langA}
        disabled={disabled}
      />
    </div>
  );
}

function LiveTargetBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="langbar live">
      <span className="live-arrow">すべてを翻訳 →</span>
      <LangSelect value={value} onChange={onChange} />
    </div>
  );
}

function LangSelect({
  value,
  onChange,
  exclude,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  exclude?: string;
  disabled?: boolean;
}) {
  const lang = getLanguage(value);
  return (
    <label className={`langselect${disabled ? " disabled" : ""}`}>
      <span className="langselect-flag">{lang.flag}</span>
      <span className="langselect-name">{lang.name}</span>
      <span className="langselect-caret">▾</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label="言語を選択"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} disabled={l.code === exclude}>
            {l.flag} {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ---------------- Conversation transcript ---------------- */

function TalkTranscript({
  segments,
  langB,
  partialSource,
  partialTarget,
  activeSide,
}: {
  segments: ReturnType<typeof useTranslator>["segments"];
  langB: string;
  partialSource: string;
  partialTarget: string;
  activeSide: Side | null;
}) {
  if (segments.length === 0 && !partialSource && !partialTarget) {
    return (
      <Empty
        title="会話をはじめましょう"
        body="話す言語のボタンを押してから話してください。相手の言語に翻訳した音声が再生され、字幕も表示されます。"
      />
    );
  }
  return (
    <div className="bubbles">
      {segments.map((s) => {
        // Output went to B ⇒ the speaker was side A ("you").
        const mine = s.outputLang === langB;
        return (
          <div key={s.id} className={`bubble ${mine ? "mine" : "theirs"}`}>
            <p className="bubble-main">{s.target || "…"}</p>
            {s.source && <p className="bubble-sub">{s.source}</p>}
          </div>
        );
      })}
      {(partialSource || partialTarget) && (
        <div
          className={`bubble pending ${activeSide === "A" ? "mine" : "theirs"}`}
        >
          <p className="bubble-main">{partialTarget || "…"}</p>
          {partialSource && <p className="bubble-sub">{partialSource}</p>}
        </div>
      )}
    </div>
  );
}

/* ---------------- Live transcript ---------------- */

function LiveTranscript({
  segments,
  partialSource,
  partialTarget,
  live,
}: {
  segments: ReturnType<typeof useTranslator>["segments"];
  partialSource: string;
  partialTarget: string;
  live: boolean;
}) {
  if (segments.length === 0 && !partialSource && !partialTarget) {
    return (
      <Empty
        title="ライブ翻訳"
        body={
          live
            ? "話しかけてください。聞こえた音声をリアルタイムで翻訳します。"
            : "出力言語を選び「翻訳をはじめる」を押してください。講演や動画など、聞こえる音声を字幕＋音声で翻訳します。"
        }
      />
    );
  }
  return (
    <div className="live-feed">
      {segments.map((s) => (
        <div key={s.id} className="live-line done">
          <p className="live-target">{s.target}</p>
          {s.source && <p className="live-source">{s.source}</p>}
        </div>
      ))}
      {(partialSource || partialTarget) && (
        <div className="live-line current">
          <p className="live-target">{partialTarget || "…"}</p>
          {partialSource && <p className="live-source">{partialSource}</p>}
        </div>
      )}
    </div>
  );
}

/* ---------------- Talk button ---------------- */

function TalkButton({
  lang,
  active,
  speaking,
  busy,
  onClick,
}: {
  lang: string;
  active: boolean;
  speaking: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  const l = getLanguage(lang);
  return (
    <button
      className={`talk ${active ? "active" : ""} ${active && speaking ? "speaking" : ""}`}
      onClick={onClick}
      disabled={busy}
    >
      <span className="talk-flag">{l.flag}</span>
      <span className="talk-name">{l.name}</span>
      <span className="talk-hint">
        {active ? (speaking ? "聞いています…" : "話してください") : "押して話す"}
      </span>
      <span className="talk-wave" aria-hidden>
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    </button>
  );
}

/* ---------------- Empty state ---------------- */

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty">
      <div className="empty-glyph">🌐</div>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}
