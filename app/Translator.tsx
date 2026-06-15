"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { LANGUAGES, getLanguage, detectPairLanguage } from "@/lib/languages";
import { useTranslator, type Segment } from "@/lib/useTranslator";
import {
  detectPlatform,
  getMicPermission,
  micFixSteps,
  type MicPermission,
  type Platform,
} from "@/lib/platform";

type Mode = "talk" | "live";
type RefinedLine = { source?: string; target?: string };

// Browser-only platform detection, exposed via useSyncExternalStore so it stays
// SSR-safe (server snapshot = null) without a hydration mismatch.
let cachedPlatform: Platform | null = null;
function platformSnapshot(): Platform | null {
  if (!cachedPlatform) cachedPlatform = detectPlatform();
  return cachedPlatform;
}
const noopSubscribe = () => () => {};

export default function Translator() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const t = useTranslator(audioRef);

  const [mode, setMode] = useState<Mode>("talk");

  // Conversation language pair (auto two-way translation between these two).
  const [langA, setLangA] = useState("ja");
  const [langB, setLangB] = useState("en");

  // Live mode: translate everything heard into this language.
  const [targetLang, setTargetLang] = useState("ja");

  const platform = useSyncExternalStore(
    noopSubscribe,
    platformSnapshot,
    () => null,
  );
  const [micPerm, setMicPerm] = useState<MicPermission>("unknown");
  const [optimizing, setOptimizing] = useState(false);

  // Flip the whole UI 180° so the person across the table can read it. Driven
  // either manually or, when granted, by the device's tilt sensor.
  const [flipped, setFlipped] = useState(false);
  const [orientOn, setOrientOn] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the transcript as new content arrives.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [t.segments, t.partialSource, t.partialTarget]);

  // Keep the auto-translation pair in sync with the selected languages.
  useEffect(() => {
    t.setAutoPair(mode === "talk" ? { a: langA, b: langB } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, langA, langB]);

  // Read the current mic permission on mount so we can warn before the first tap.
  useEffect(() => {
    let alive = true;
    getMicPermission().then((p) => {
      if (alive) setMicPerm(p);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Post-pass optimization: every time a NEW line is finalized, re-optimize the
  // WHOLE conversation from the raw real-time text (both transcription and
  // translation), using GPT-5.5 with full context, then swap every bubble.
  const segsRef = useRef(t.segments);
  useEffect(() => {
    segsRef.current = t.segments;
  }, [t.segments]);

  const optRunning = useRef(false);

  const runOptimize = useCallback(async () => {
    if (optRunning.current) return;
    optRunning.current = true;
    setOptimizing(true);
    try {
      let lastLen = -1;
      // Loop so that lines finalized *during* a request get re-optimized too.
      while (segsRef.current.length !== lastLen && segsRef.current.length > 0) {
        const snapshot = segsRef.current;
        lastLen = snapshot.length;
        const lines = snapshot.map((s) => ({
          source: s.rawSource,
          target: s.rawTarget,
          sourceLang: s.sourceLang,
          targetLang: s.outputLang,
        }));
        let out: RefinedLine[] | null = null;
        try {
          const res = await fetch("/api/refine", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lines }),
          });
          const data = (await res.json()) as { lines?: RefinedLine[] };
          if (Array.isArray(data.lines) && data.lines.length === snapshot.length) {
            out = data.lines;
          }
        } catch {
          out = null;
        }
        snapshot.forEach((s, i) => {
          const r = out?.[i];
          t.patchSegment(s.id, {
            source: typeof r?.source === "string" ? r.source : s.source,
            target: typeof r?.target === "string" ? r.target : s.target,
            refined: true,
          });
        });
      }
    } finally {
      optRunning.current = false;
      setOptimizing(false);
    }
  }, [t]);

  useEffect(() => {
    if (t.segments.length > 0) void runOptimize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.segments.length]);

  // Ask for tilt-sensor access (iOS needs a gesture) and turn on auto-flip.
  const enableOrientation = useCallback(async () => {
    if (orientOn) return;
    try {
      const D = window.DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<"granted" | "denied">;
      };
      if (D && typeof D.requestPermission === "function") {
        const r = await D.requestPermission();
        if (r !== "granted") return;
      }
      setOrientOn(true);
    } catch {
      // sensor not available — manual flip button still works
    }
  }, [orientOn]);

  // Auto-flip when the phone is tilted toward the other person (wide hysteresis
  // so it doesn't flip-flop), once the sensor is enabled.
  useEffect(() => {
    if (!orientOn) return;
    const onOrient = (e: DeviceOrientationEvent) => {
      const beta = e.beta;
      if (beta == null) return;
      setFlipped((prev) => {
        if (!prev && beta < 25) return true;
        if (prev && beta > 55) return false;
        return prev;
      });
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, [orientOn]);

  const switchMode = useCallback(
    (next: Mode) => {
      if (next === mode) return;
      t.stop();
      setMode(next);
    },
    [mode, t],
  );

  // Conversation: two realtime sessions (one per language) run at once so BOTH
  // directions are translated live; we show the one going away from the speaker.
  const onConvToggle = useCallback(async () => {
    if (t.status === "idle" || t.status === "error") {
      void enableOrientation();
      t.setAutoPair({ a: langA, b: langB });
      await t.start([langA, langB]);
    } else {
      t.stop();
    }
  }, [t, langA, langB, enableOrientation]);

  const onLiveToggle = useCallback(async () => {
    if (t.status === "idle" || t.status === "error") {
      t.setAutoPair(null);
      await t.start([targetLang]);
    } else {
      t.stop();
    }
  }, [t, targetLang]);

  const swap = useCallback(() => {
    setLangA(langB);
    setLangB(langA);
  }, [langA, langB]);

  const retry = useCallback(() => {
    getMicPermission().then(setMicPerm);
    if (mode === "talk") void onConvToggle();
    else void onLiveToggle();
  }, [mode, onConvToggle, onLiveToggle]);

  const live = t.status === "live";
  const connecting = t.status === "connecting";

  const micBlocked =
    micPerm === "denied" ||
    (!!t.error &&
      /マイク|許可|permission|allow|secure|HTTPS|ブラウザ/i.test(t.error));

  const startLabel = connecting
    ? "接続中…"
    : live
      ? "停止"
      : mode === "talk"
        ? "会話を始める"
        : "翻訳をはじめる";

  return (
    <div className={`app${flipped ? " flipped" : ""}`}>
      <audio ref={audioRef} autoPlay playsInline />

      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" data-status={t.status} />
          <span className="brand-name">
            {optimizing ? "✨ 全文を最適化中…" : "Realtime Translate"}
          </span>
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

      {platform?.inApp && (
        <div className="banner warn" role="alert">
          ⚠️ {platform.inApp} のアプリ内ブラウザではマイクが使えません。右上メニューから
          <b> Safari / Chrome で開く</b>を選んでください。
        </div>
      )}

      {(t.error || (micBlocked && t.status !== "live")) && (
        <MicHelp
          platform={platform}
          isMicProblem={micBlocked}
          message={t.error}
          onRetry={retry}
        />
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
          <ChatTranscript
            segments={t.segments}
            langA={langA}
            langB={langB}
            partialSource={t.partialSource}
            partialTarget={t.partialTarget}
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
          {mode === "live" && (
            <button
              className={`audio-toggle ${t.audioOn ? "on" : ""}`}
              onClick={() => t.setAudioOn(!t.audioOn)}
              aria-pressed={t.audioOn}
            >
              <span className="audio-ico">{t.audioOn ? "🔊" : "🔇"}</span>
              音声出力 {t.audioOn ? "ON" : "OFF"}
            </button>
          )}
          <button
            className={`audio-toggle flip ${flipped ? "on" : ""}`}
            onClick={() => setFlipped((v) => !v)}
            aria-pressed={flipped}
            title="相手に見せる（画面を上下反転）"
          >
            <span className="audio-ico">🔄</span>
            相手向き
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

        <div className="live-controls">
          <button
            className={`record ${live ? "on" : ""}`}
            onClick={mode === "talk" ? onConvToggle : onLiveToggle}
            disabled={connecting}
          >
            <span className="record-icon" />
            {startLabel}
          </button>
        </div>
      </footer>
    </div>
  );
}

/* ---------------- Language bars ---------------- */

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

/* ---------------- Conversation (LINE-style chat) ---------------- */

function ChatTranscript({
  segments,
  langA,
  langB,
  partialSource,
  partialTarget,
}: {
  segments: Segment[];
  langA: string;
  langB: string;
  partialSource: string;
  partialTarget: string;
}) {
  if (segments.length === 0 && !partialSource && !partialTarget) {
    return (
      <Empty
        title="自動で双方向に翻訳"
        body="「会話を始める」を押して、日本語でも英語でもそのまま話してください。話した言語を自動で判定し、相手の言語に翻訳してチャットに表示します。"
      />
    );
  }
  const sideOf = (src: string) => (src === langA ? "a" : "b");
  return (
    <div className="chat">
      {segments.map((s) => {
        const src =
          s.sourceLang ?? (s.outputLang === langA ? langB : langA);
        return (
          <ChatMsg
            key={s.id}
            side={sideOf(src)}
            srcLang={src}
            original={s.source}
            translated={s.target}
            refined={s.refined}
          />
        );
      })}
      {(partialSource || partialTarget) && (
        <ChatMsg
          side={sideOf(detectPairLanguage(partialSource, langA, langB) ?? langA)}
          srcLang={detectPairLanguage(partialSource, langA, langB) ?? langA}
          original={partialSource}
          translated={partialTarget}
          pending
        />
      )}
    </div>
  );
}

function ChatMsg({
  side,
  srcLang,
  original,
  translated,
  pending,
  refined,
}: {
  side: "a" | "b";
  srcLang: string;
  original: string;
  translated: string;
  pending?: boolean;
  refined?: boolean;
}) {
  const lang = getLanguage(srcLang);
  return (
    <div className={`msg ${side}${pending ? " pending" : ""}`}>
      <span className="msg-avatar" aria-hidden>
        {lang.flag}
      </span>
      <div className="msg-bubble">
        {/* translation on top, transcription (original) below */}
        <p className="msg-main">
          {translated || "…"}
          {refined && (
            <span className="msg-badge" title="GPT-5.5で最適化済み">
              ✨
            </span>
          )}
        </p>
        {original && <p className="msg-sub">{original}</p>}
      </div>
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
  segments: Segment[];
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
            : "出力言語を選び「翻訳をはじめる」を押してください。講演や動画など、聞こえる音声を字幕で翻訳します。"
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

/* ---------------- Mic / error help ---------------- */

function MicHelp({
  platform,
  isMicProblem,
  message,
  onRetry,
}: {
  platform: Platform | null;
  isMicProblem: boolean;
  message: string | null;
  onRetry: () => void;
}) {
  const steps = isMicProblem && platform ? micFixSteps(platform) : [];
  return (
    <div className="michelp" role="alert">
      <div className="michelp-head">
        <span className="michelp-ico">🎤</span>
        {isMicProblem ? "マイクを使えませんでした" : "エラーが発生しました"}
      </div>
      {message && <p className="michelp-msg">{message}</p>}
      {steps.length > 0 && (
        <ol className="michelp-steps">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      <div className="michelp-actions">
        <button className="michelp-btn primary" onClick={onRetry}>
          もう一度試す
        </button>
        <button
          className="michelp-btn"
          onClick={() => window.location.reload()}
        >
          再読み込み
        </button>
      </div>
    </div>
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
