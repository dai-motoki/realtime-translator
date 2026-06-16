"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { LANGUAGES, getLanguage, detectLanguage } from "@/lib/languages";
import { useTranslator, type Segment } from "@/lib/useTranslator";
import {
  detectPlatform,
  getMicPermission,
  micFixSteps,
  type MicPermission,
  type Platform,
} from "@/lib/platform";

type Mode = "talk" | "live";
type RefinedTarget = { lang?: string; target?: string };
type RefinedLine = { source?: string; targets?: RefinedTarget[] };

// Default conversation languages (speak any one → translated into the others).
const DEFAULT_CONV_LANGS = ["ja", "en", "zh"];

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

  // Conversation languages (auto multi-way translation: speak any one and it's
  // translated into all the others).
  const [convLangs, setConvLangs] = useState<string[]>(DEFAULT_CONV_LANGS);

  const toggleConvLang = useCallback((code: string) => {
    setConvLangs((prev) => {
      if (prev.includes(code)) {
        // Keep at least two languages in the conversation.
        return prev.length > 2 ? prev.filter((c) => c !== code) : prev;
      }
      // Keep selection ordered by the master language list for stable display.
      const next = [...prev, code];
      return LANGUAGES.map((l) => l.code).filter((c) => next.includes(c));
    });
  }, []);

  // Live mode: translate everything heard into this language.
  const [targetLang, setTargetLang] = useState("ja");

  const platform = useSyncExternalStore(
    noopSubscribe,
    platformSnapshot,
    () => null,
  );
  const [micPerm, setMicPerm] = useState<MicPermission>("unknown");
  const [optimizing, setOptimizing] = useState(false);

  // Flip the whole UI 180° so the person across the table can read it. Toggled
  // manually with the "相手向き" button.
  const [flipped, setFlipped] = useState(false);

  // Whether the conversation-language picker is expanded (default: expanded).
  const [langOpen, setLangOpen] = useState(true);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the transcript as new content arrives.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [t.segments, t.partialSource, t.partialTargets]);

  // Keep the auto-translation languages in sync with the selection.
  useEffect(() => {
    t.setAutoLangs(mode === "talk" ? convLangs : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, convLangs]);

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

  // Post-pass optimization: when a NEW line is finalized, re-optimize the latest
  // not-yet-refined lines from the raw real-time text (transcription and all
  // translations), using GPT-5.5 with recent context, then swap those bubbles.
  const segsRef = useRef(t.segments);
  useEffect(() => {
    segsRef.current = t.segments;
  }, [t.segments]);

  const optRunning = useRef(false);

  const runOptimize = useCallback(async () => {
    if (optRunning.current) return;
    optRunning.current = true;
    setOptimizing(true);
    // How many already-refined lines to send as read-only context.
    const CONTEXT_LINES = 4;
    // Track what we've optimized this run so we make progress even before the
    // `refined` flag has propagated back into segsRef.
    const done = new Set<string>();
    try {
      // Optimize only the latest, not-yet-refined lines (prioritising the
      // newest conversation) instead of re-editing the whole transcript every
      // time. Loops to pick up lines finalized *during* a request.
      while (true) {
        const snapshot = segsRef.current;
        const firstIdx = snapshot.findIndex(
          (s) => !s.refined && !done.has(s.id),
        );
        if (firstIdx === -1) break;

        const ctxStart = Math.max(0, firstIdx - CONTEXT_LINES);
        const windowSegs = snapshot.slice(ctxStart);
        const optimizeFrom = firstIdx - ctxStart;
        const targets = windowSegs.slice(optimizeFrom);

        // Context lines use their already-polished text; targets use the raw
        // realtime text so the model re-edits from the original.
        const lines = windowSegs.map((s, idx) => {
          const isCtx = idx < optimizeFrom;
          const map = isCtx ? s.targets : s.rawTargets;
          return {
            source: isCtx ? s.source : s.rawSource,
            sourceLang: s.sourceLang,
            targets: Object.entries(map).map(([lang, target]) => ({
              lang,
              target,
            })),
          };
        });

        let out: RefinedLine[] | null = null;
        try {
          const res = await fetch("/api/refine", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lines, optimizeFrom }),
          });
          const data = (await res.json()) as { lines?: RefinedLine[] };
          if (Array.isArray(data.lines) && data.lines.length === targets.length) {
            out = data.lines;
          }
        } catch {
          out = null;
        }
        targets.forEach((s, i) => {
          const r = out?.[i];
          done.add(s.id);
          // Merge any returned translations back over the existing ones.
          const nextTargets = { ...s.targets };
          if (Array.isArray(r?.targets)) {
            for (const rt of r.targets) {
              if (rt && typeof rt.lang === "string" && typeof rt.target === "string") {
                nextTargets[rt.lang] = rt.target;
              }
            }
          }
          t.patchSegment(s.id, {
            source: typeof r?.source === "string" ? r.source : s.source,
            targets: nextTargets,
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

  const switchMode = useCallback(
    (next: Mode) => {
      if (next === mode) return;
      t.stop();
      setMode(next);
    },
    [mode, t],
  );

  // Conversation: one realtime session per language runs at once, so whoever
  // speaks is translated into every other language live.
  const onConvToggle = useCallback(async () => {
    if (t.status === "idle" || t.status === "error") {
      t.setAutoLangs(convLangs);
      await t.start(convLangs);
    } else {
      t.stop();
    }
  }, [t, convLangs]);

  const onLiveToggle = useCallback(async () => {
    if (t.status === "idle" || t.status === "error") {
      t.setAutoLangs(null);
      await t.start([targetLang]);
    } else {
      t.stop();
    }
  }, [t, targetLang]);

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
            {optimizing ? "✨ 最新の会話を最適化中…" : "Realtime Translate"}
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
        <LangChips
          selected={convLangs}
          onToggle={toggleConvLang}
          disabled={live || connecting}
          open={langOpen}
          onToggleOpen={() => setLangOpen((v) => !v)}
        />
      ) : (
        <LiveTargetBar value={targetLang} onChange={setTargetLang} />
      )}

      <main className="transcript" ref={scrollRef}>
        {mode === "talk" ? (
          <ChatTranscript
            segments={t.segments}
            convLangs={convLangs}
            partialSource={t.partialSource}
            partialTargets={t.partialTargets}
          />
        ) : (
          <LiveTranscript
            segments={t.segments}
            partialSource={t.partialSource}
            partialTargets={t.partialTargets}
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

function LangChips({
  selected,
  onToggle,
  disabled,
  open,
  onToggleOpen,
}: {
  selected: string[];
  onToggle: (code: string) => void;
  disabled: boolean;
  open: boolean;
  onToggleOpen: () => void;
}) {
  return (
    <div className="langchips-wrap">
      <button
        type="button"
        className="langchips-head"
        aria-expanded={open}
        onClick={onToggleOpen}
      >
        <span className="langchips-caret">{open ? "▾" : "▸"}</span>
        <span className="langchips-title">言語</span>
        {!open && (
          <span className="langchips-summary">
            {selected.map((c) => getLanguage(c).flag).join(" ")}
          </span>
        )}
      </button>
      {open && (
        <div className={`langchips${disabled ? " disabled" : ""}`}>
          {LANGUAGES.map((l) => {
            const on = selected.includes(l.code);
            return (
              <button
                key={l.code}
                type="button"
                className={`langchip${on ? " on" : ""}`}
                aria-pressed={on}
                disabled={disabled}
                onClick={() => onToggle(l.code)}
              >
                <span className="langchip-flag">{l.flag}</span>
                <span className="langchip-name">{l.name}</span>
              </button>
            );
          })}
        </div>
      )}
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

type ChatTarget = { lang: string; text: string };

function ChatTranscript({
  segments,
  convLangs,
  partialSource,
  partialTargets,
}: {
  segments: Segment[];
  convLangs: string[];
  partialSource: string;
  partialTargets: Record<string, string>;
}) {
  const hasPartial =
    !!partialSource || Object.keys(partialTargets).length > 0;
  if (segments.length === 0 && !hasPartial) {
    return (
      <Empty
        title="自動で多言語に翻訳"
        body="「会話を始める」を押して、選んだ言語のどれかでそのまま話してください。話した言語を自動で判定し、ほかの言語すべてに翻訳してチャットに表示します。"
      />
    );
  }
  const sideOf = (lang: string) =>
    convLangs.indexOf(lang) % 2 === 0 ? "a" : "b";
  const targetsOf = (
    src: string,
    map: Record<string, string>,
    keepEmpty: boolean,
  ): ChatTarget[] =>
    convLangs
      .filter((l) => l !== src)
      .map((l) => ({ lang: l, text: map[l] ?? "" }))
      .filter((x) => keepEmpty || x.text);

  return (
    <div className="chat">
      {segments.map((s) => {
        const src =
          s.sourceLang ?? detectLanguage(s.source, convLangs) ?? convLangs[0];
        return (
          <ChatMsg
            key={s.id}
            side={sideOf(src)}
            srcLang={src}
            original={s.source}
            targets={targetsOf(src, s.targets, false)}
            refined={s.refined}
          />
        );
      })}
      {hasPartial &&
        (() => {
          const src = detectLanguage(partialSource, convLangs) ?? convLangs[0];
          return (
            <ChatMsg
              side={sideOf(src)}
              srcLang={src}
              original={partialSource}
              targets={targetsOf(src, partialTargets, true)}
              pending
            />
          );
        })()}
    </div>
  );
}

function ChatMsg({
  side,
  srcLang,
  original,
  targets,
  pending,
  refined,
}: {
  side: "a" | "b";
  srcLang: string;
  original: string;
  targets: ChatTarget[];
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
        {/* what was actually said (top), then a translation per language */}
        <p className="msg-main">
          {original || "…"}
          {refined && (
            <span className="msg-badge" title="GPT-5.5で最適化済み">
              ✨
            </span>
          )}
        </p>
        {targets.map((tg) => (
          <p key={tg.lang} className="msg-trans">
            <span className="msg-trans-flag" aria-hidden>
              {getLanguage(tg.lang).flag}
            </span>
            {tg.text || "…"}
          </p>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Live transcript ---------------- */

function LiveTranscript({
  segments,
  partialSource,
  partialTargets,
  live,
}: {
  segments: Segment[];
  partialSource: string;
  partialTargets: Record<string, string>;
  live: boolean;
}) {
  const firstVal = (m: Record<string, string>) => Object.values(m)[0] ?? "";
  const hasPartial =
    !!partialSource || Object.keys(partialTargets).length > 0;
  if (segments.length === 0 && !hasPartial) {
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
          <p className="live-target">{firstVal(s.targets)}</p>
          {s.source && <p className="live-source">{s.source}</p>}
        </div>
      ))}
      {hasPartial && (
        <div className="live-line current">
          <p className="live-target">{firstVal(partialTargets) || "…"}</p>
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
