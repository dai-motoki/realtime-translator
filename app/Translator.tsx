"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  LANGUAGES,
  getLanguage,
  isRealtimeVoice,
  detectLanguage,
  detectLanguageByOutputs,
} from "@/lib/languages";
import { useTranslator, type Segment } from "@/lib/useTranslator";
import {
  resolveBaseLang,
  saveBaseLang,
  defaultConvLangs,
} from "@/lib/locale";
import { useSpeech } from "@/lib/useSpeech";
import { useStudy, type StudyLine } from "@/lib/useStudy";
import {
  useConversations,
  type LoggedSegment,
} from "@/lib/useConversations";
import { useDiarization, type TimedLine } from "@/lib/useDiarization";
import { SpeakerTag } from "./SpeakerTag";
import { StudyPanel } from "./StudyPanel";
import { LogPanel } from "./LogPanel";
import { Typewriter } from "./Typewriter";
import {
  detectPlatform,
  getMicPermission,
  micFixSteps,
  type MicPermission,
  type Platform,
} from "@/lib/platform";

type Mode = "talk" | "live";
type RefinedTarget = { lang?: string; target?: string; reading?: string };
type RefinedLine = {
  source?: string;
  sourceReading?: string;
  targets?: RefinedTarget[];
};

// Browser-only platform detection, exposed via useSyncExternalStore so it stays
// SSR-safe (server snapshot = null) without a hydration mismatch.
let cachedPlatform: Platform | null = null;
function platformSnapshot(): Platform | null {
  if (!cachedPlatform) cachedPlatform = detectPlatform();
  return cachedPlatform;
}

// Base language = the language this device's owner reads/speaks. Resolved once
// from a remembered choice or the device locale, and exposed through
// useSyncExternalStore so it stays SSR-safe (server snapshot = null) just like
// the platform probe above.
let cachedBaseLang: string | null = null;
function baseLangSnapshot(): string | null {
  if (!cachedBaseLang) cachedBaseLang = resolveBaseLang();
  return cachedBaseLang;
}

const noopSubscribe = () => () => {};

export default function Translator() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const t = useTranslator(audioRef);
  // On-demand text-to-speech: tap any finalized line to hear it spoken.
  const speech = useSpeech();
  // Vocabulary + grammar study built from the conversation, saved on-device.
  const study = useStudy();
  const [studyOpen, setStudyOpen] = useState(false);
  // Saved conversation logs + auto-generated minutes (localStorage for now).
  const convos = useConversations();
  const [logOpen, setLogOpen] = useState(false);
  // Speaker diarization (who's talking) — only active when Picovoice is set up.
  const diar = useDiarization();
  // When on, new lines are auto-filed into the 単語帳 / 文法ノート as you talk.
  const [autoStudy, setAutoStudy] = useState(true);

  const [mode, setMode] = useState<Mode>("talk");

  // Resolved device / remembered base language (null during SSR + first paint).
  const baseLang = useSyncExternalStore(
    noopSubscribe,
    baseLangSnapshot,
    () => null,
  );

  // Conversation languages (auto multi-way translation: speak any one and it's
  // translated into all the others). Until the user edits the set we derive it
  // from the base language so their own language is included and listed first;
  // `convOverride` holds an explicit selection once they toggle a chip. The
  // base language only seeds this default — it never rewrites an existing
  // selection or the multi-language translation results.
  const [convOverride, setConvOverride] = useState<string[] | null>(null);
  const convLangs = useMemo(
    () => convOverride ?? defaultConvLangs(baseLang ?? "ja"),
    [convOverride, baseLang],
  );

  const toggleConvLang = useCallback(
    (code: string) => {
      setConvOverride(() => {
        if (convLangs.includes(code)) {
          // Keep at least two languages in the conversation.
          return convLangs.length > 2
            ? convLangs.filter((c) => c !== code)
            : convLangs;
        }
        // Keep selection ordered by the master language list for stable display.
        const next = [...convLangs, code];
        return LANGUAGES.map((l) => l.code).filter((c) => next.includes(c));
      });
    },
    [convLangs],
  );

  // Live mode: translate everything heard into this language. Defaults to the
  // base language; `targetOverride` holds an explicit pick from the selector.
  const [targetOverride, setTargetOverride] = useState<string | null>(null);
  const targetLang = targetOverride ?? baseLang ?? "ja";
  const setTargetLang = useCallback((v: string) => {
    setTargetOverride(v);
    // Remember the chosen output language (翻訳後言語) for next time.
    saveBaseLang(v);
  }, []);

  // Persist the resolved base language once it's known, so a first-time visitor
  // keeps the device-detected language on their next visit too.
  useEffect(() => {
    if (baseLang && !targetOverride) saveBaseLang(baseLang);
  }, [baseLang, targetOverride]);

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

  // Show a pronunciation guide (romaji / pinyin / IPA …) under each line.
  const [showReading, setShowReading] = useState(true);

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
          // Merge any returned translations and pronunciation readings back over
          // the existing ones.
          const nextTargets = { ...s.targets };
          const nextReadings = { ...(s.readings ?? {}) };
          if (Array.isArray(r?.targets)) {
            for (const rt of r.targets) {
              if (rt && typeof rt.lang === "string" && typeof rt.target === "string") {
                nextTargets[rt.lang] = rt.target;
              }
              if (rt && typeof rt.lang === "string" && typeof rt.reading === "string" && rt.reading) {
                nextReadings[rt.lang] = rt.reading;
              }
            }
          }
          t.patchSegment(s.id, {
            source: typeof r?.source === "string" ? r.source : s.source,
            sourceReading:
              typeof r?.sourceReading === "string" && r.sourceReading
                ? r.sourceReading
                : s.sourceReading,
            targets: nextTargets,
            readings: nextReadings,
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

  // ---- Conversation log + auto minutes ----
  // Snapshot the just-finished conversation into the on-device log, which also
  // kicks off automatic 議事録 (minutes) generation. The store dedupes by
  // content, so a stop-then-clear can't file the same conversation twice.
  const archiveConv = convos.archive;
  const speakers = diar.speakers;
  const archiveCurrent = useCallback(() => {
    const segs = t.segments;
    if (segs.length === 0) return;
    const logged: LoggedSegment[] = segs.map((s) => ({
      source: s.source,
      sourceLang: s.sourceLang,
      sourceReading: s.sourceReading,
      targets: s.targets,
      readings: s.readings,
      speaker: speakers[s.id],
      at: s.at,
    }));
    archiveConv({
      mode,
      langs: mode === "talk" ? convLangs : [targetLang],
      lang: baseLang ?? "ja",
      segments: logged,
    });
  }, [t.segments, mode, convLangs, targetLang, baseLang, archiveConv, speakers]);

  // Call the latest archive fn from the status effect without making that effect
  // depend on (and re-run for) every render.
  const archiveRef = useRef(archiveCurrent);
  useEffect(() => {
    archiveRef.current = archiveCurrent;
  });

  // Auto-archive whenever a live session ends (停止／終了／モード切替). The
  // finalized segments are still in state at that moment.
  const prevStatusRef = useRef(t.status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = t.status;
    if ((prev === "live" || prev === "connecting") && t.status === "idle") {
      archiveRef.current();
    }
  }, [t.status]);

  // "履歴を消す": archive the conversation before wiping it off the screen.
  const clearHistory = useCallback(() => {
    archiveRef.current();
    diar.reset();
    t.clear();
  }, [t, diar]);

  // ---- Speaker diarization ----
  // Record the mic while we're listening; release the recorder when we stop.
  useEffect(() => {
    if (t.activeStream) void diar.start(t.activeStream);
    else diar.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.activeStream]);

  // A couple seconds after the conversation grows, re-diarize the whole
  // recording so speaker labels appear (and sharpen) in near-real-time.
  const diarLinesRef = useRef<TimedLine[]>([]);
  const diarRunRef = useRef(diar.run);
  useEffect(() => {
    diarLinesRef.current = t.segments.map((s) => ({
      id: s.id,
      startedAt: s.startedAt,
      at: s.at,
    }));
    diarRunRef.current = diar.run;
  });
  useEffect(() => {
    if (!diar.configured || t.segments.length === 0) return;
    const id = window.setTimeout(() => {
      void diarRunRef.current(diarLinesRef.current);
    }, 2500);
    return () => window.clearTimeout(id);
  }, [t.segments.length, diar.configured]);

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

  // Compact view of the conversation for the study generator.
  const studyLines: StudyLine[] = useMemo(
    () =>
      t.segments.map((s) => ({
        source: s.source,
        sourceLang: s.sourceLang,
        targets: Object.entries(s.targets).map(([lang, target]) => ({
          lang,
          target,
        })),
      })),
    [t.segments],
  );

  // Latest-value refs so the debounced auto-study effect needn't depend on the
  // (re-created-each-render) study object or lines array.
  const studyLinesRef = useRef(studyLines);
  const accumulateRef = useRef(study.accumulate);
  useEffect(() => {
    studyLinesRef.current = studyLines;
    accumulateRef.current = study.accumulate;
  });

  // Auto-accumulation: a few seconds after the conversation grows, file any new
  // lines into the saved 単語帳 / 文法ノート. Dedup makes re-sends harmless.
  const studiedRef = useRef(0);
  useEffect(() => {
    const n = t.segments.length;
    if (n < studiedRef.current) studiedRef.current = n; // history cleared
    if (!autoStudy || n <= studiedRef.current) return;
    const id = window.setTimeout(() => {
      const lines = studyLinesRef.current;
      if (lines.length <= studiedRef.current) return;
      const from = Math.max(0, studiedRef.current - 1); // 1 line of context
      studiedRef.current = lines.length;
      void accumulateRef.current(lines.slice(from));
    }, 5000);
    return () => window.clearTimeout(id);
  }, [t.segments.length, autoStudy]);

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
            speech={speech}
            showReading={showReading}
            speakers={diar.speakers}
          />
        ) : (
          <LiveTranscript
            segments={t.segments}
            partialSource={t.partialSource}
            partialTargets={t.partialTargets}
            live={live}
            speech={speech}
            showReading={showReading}
            speakers={diar.speakers}
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
            className={`audio-toggle ${showReading ? "on" : ""}`}
            onClick={() => setShowReading((v) => !v)}
            aria-pressed={showReading}
            title="発音記号（ローマ字・ピンイン・IPAなど）を表示"
          >
            <span className="audio-ico">あ</span>
            発音記号 {showReading ? "ON" : "OFF"}
          </button>
          <button
            className="audio-toggle study-open"
            onClick={() => setStudyOpen(true)}
            title="この会話から単語・文法を学ぶ"
          >
            <span className="audio-ico">📚</span>
            学習
            {study.savedVocab.length > 0 && (
              <span className="study-count">{study.savedVocab.length}</span>
            )}
          </button>
          <button
            className="audio-toggle log-open"
            onClick={() => setLogOpen(true)}
            title="議事録と会話ログを見る"
          >
            <span className="audio-ico">📝</span>
            議事録
            {convos.conversations.length > 0 && (
              <span className="study-count">{convos.conversations.length}</span>
            )}
          </button>
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
            <button className="ghost" onClick={clearHistory}>
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

      <StudyPanel
        open={studyOpen}
        onClose={() => setStudyOpen(false)}
        study={study}
        speech={speech}
        lines={studyLines}
        auto={autoStudy}
        onToggleAuto={() => setAutoStudy((v) => !v)}
      />

      <LogPanel
        open={logOpen}
        onClose={() => setLogOpen(false)}
        convos={convos}
      />
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
  const [showAll, setShowAll] = useState(false);
  // Common languages up-front; the rest are shown only when "もっと見る" is
  // tapped — but a selected non-common language always stays visible.
  const shown = showAll
    ? LANGUAGES
    : LANGUAGES.filter((l) => l.common || selected.includes(l.code));
  const hiddenCount = LANGUAGES.length - shown.length;

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
          {shown.map((l) => {
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
                {!l.realtime && (
                  <span
                    className="langchip-sub"
                    title="リアルタイム音声には非対応（テキスト翻訳のみ）"
                  >
                    字幕
                  </span>
                )}
              </button>
            );
          })}
          {(showAll || hiddenCount > 0) && (
            <button
              type="button"
              className="langchip more"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "− 閉じる" : `＋ もっと見る (${hiddenCount})`}
            </button>
          )}
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
      {!lang.realtime && (
        <span
          className="langselect-sub"
          title="リアルタイム音声には非対応（テキスト翻訳のみ）"
        >
          字幕のみ
        </span>
      )}
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
            {l.realtime ? "" : " ・字幕のみ"}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ---------------- Conversation (LINE-style chat) ---------------- */

type ChatTarget = { lang: string; text: string; reading?: string };

type Speech = ReturnType<typeof useSpeech>;

/** A small 🔊 button that speaks one line of text on demand. */
function SpeakButton({
  speech,
  spKey,
  text,
  lang,
}: {
  speech: Speech;
  spKey: string;
  text: string;
  lang?: string;
}) {
  const loading = speech.loadingKey === spKey;
  const playing = speech.playingKey === spKey;
  return (
    <button
      type="button"
      className={`speak-btn${playing ? " playing" : ""}`}
      aria-label={playing ? "停止" : "読み上げ"}
      aria-pressed={playing}
      onClick={() => speech.speak(spKey, text, lang)}
    >
      {loading ? "…" : playing ? "⏸" : "🔊"}
    </button>
  );
}

function ChatTranscript({
  segments,
  convLangs,
  partialSource,
  partialTargets,
  speech,
  showReading,
  speakers,
}: {
  segments: Segment[];
  convLangs: string[];
  partialSource: string;
  partialTargets: Record<string, string>;
  speech: Speech;
  showReading: boolean;
  speakers: Record<string, number>;
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
    readings?: Record<string, string>,
  ): ChatTarget[] =>
    convLangs
      .filter((l) => l !== src)
      .map((l) => ({ lang: l, text: map[l] ?? "", reading: readings?.[l] }))
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
            sourceReading={s.sourceReading}
            targets={targetsOf(src, s.targets, false, s.readings)}
            refined={s.refined}
            speech={speech}
            speakKey={s.id}
            showReading={showReading}
            speaker={speakers[s.id]}
          />
        );
      })}
      {hasPartial &&
        (() => {
          // While the source is still streaming and script-ambiguous (e.g.
          // Latin-script languages), use the live translations to tell which
          // language is being spoken, matching how finalized lines resolve it.
          const src =
            detectLanguage(partialSource, convLangs) ??
            detectLanguageByOutputs(partialSource, convLangs, partialTargets) ??
            convLangs[0];
          return (
            <ChatMsg
              side={sideOf(src)}
              srcLang={src}
              original={partialSource}
              targets={targetsOf(src, partialTargets, true)}
              pending
              showReading={showReading}
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
  sourceReading,
  targets,
  pending,
  refined,
  speech,
  speakKey,
  showReading,
  speaker,
}: {
  side: "a" | "b";
  srcLang: string;
  original: string;
  sourceReading?: string;
  targets: ChatTarget[];
  pending?: boolean;
  refined?: boolean;
  speech?: Speech;
  speakKey?: string;
  showReading?: boolean;
  speaker?: number;
}) {
  const lang = getLanguage(srcLang);
  // Speak buttons appear only on finalized lines (not the streaming bubble).
  const canSpeak = !pending && !!speech && !!speakKey;
  return (
    <div className={`msg ${side}${pending ? " pending" : ""}`}>
      <span className="msg-avatar" aria-hidden>
        {lang.flag}
      </span>
      <div className="msg-bubble">
        {speaker ? <SpeakerTag n={speaker} /> : null}
        {/* what was actually said (top), then a translation per language */}
        <p className="msg-main">
          {original ? (
            pending ? (
              <Typewriter text={original} />
            ) : (
              original
            )
          ) : (
            "…"
          )}
          {refined && (
            <span className="msg-badge" title="GPT-5.5で最適化済み">
              ✨
            </span>
          )}
          {canSpeak && original && (
            <SpeakButton
              speech={speech}
              spKey={`${speakKey}:src`}
              text={original}
              lang={srcLang}
            />
          )}
        </p>
        {showReading && sourceReading && (
          <p className="msg-reading">{sourceReading}</p>
        )}
        {targets.map((tg) => (
          <div key={tg.lang} className="msg-trans-block">
            <p className="msg-trans">
              <span className="msg-trans-flag" aria-hidden>
                {getLanguage(tg.lang).flag}
              </span>
              {!isRealtimeVoice(tg.lang) && (
                <span
                  className="trans-sub-tag"
                  title="リアルタイム音声には非対応（テキスト翻訳のみ）"
                >
                  字幕
                </span>
              )}
              {tg.text ? (
                pending ? (
                  <Typewriter text={tg.text} />
                ) : (
                  tg.text
                )
              ) : (
                "…"
              )}
              {canSpeak && tg.text && (
                <SpeakButton
                  speech={speech}
                  spKey={`${speakKey}:${tg.lang}`}
                  text={tg.text}
                  lang={tg.lang}
                />
              )}
            </p>
            {showReading && tg.reading && (
              <p className="msg-reading sub">{tg.reading}</p>
            )}
          </div>
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
  speech,
  showReading,
  speakers,
}: {
  segments: Segment[];
  partialSource: string;
  partialTargets: Record<string, string>;
  live: boolean;
  speech: Speech;
  showReading: boolean;
  speakers: Record<string, number>;
}) {
  const firstVal = (m: Record<string, string>) => Object.values(m)[0] ?? "";
  const firstKey = (m: Record<string, string>) => Object.keys(m)[0];
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
      {segments.map((s) => {
        const tgtText = firstVal(s.targets);
        const tgtLang = firstKey(s.targets);
        const tgtReading = tgtLang ? s.readings?.[tgtLang] : undefined;
        return (
          <div key={s.id} className="live-line done">
            {speakers[s.id] ? <SpeakerTag n={speakers[s.id]} /> : null}
            <p className="live-target">
              {tgtText}
              {tgtText && (
                <SpeakButton
                  speech={speech}
                  spKey={`${s.id}:tgt`}
                  text={tgtText}
                  lang={tgtLang}
                />
              )}
            </p>
            {showReading && tgtReading && (
              <p className="msg-reading">{tgtReading}</p>
            )}
            {s.source && (
              <p className="live-source">
                {s.source}
                <SpeakButton
                  speech={speech}
                  spKey={`${s.id}:src`}
                  text={s.source}
                  lang={s.sourceLang ?? undefined}
                />
              </p>
            )}
            {showReading && s.sourceReading && (
              <p className="msg-reading">{s.sourceReading}</p>
            )}
          </div>
        );
      })}
      {hasPartial &&
        (() => {
          const tgt = firstVal(partialTargets);
          return (
            <div className="live-line current">
              <p className="live-target">
                {tgt ? <Typewriter text={tgt} /> : "…"}
              </p>
              {partialSource && (
                <p className="live-source">
                  <Typewriter text={partialSource} />
                </p>
              )}
            </div>
          );
        })()}
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
