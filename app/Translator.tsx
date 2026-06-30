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
import { useT, useUiLang } from "@/lib/i18n";
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
import { MyPagePanel } from "./MyPagePanel";
import { ShareMenu } from "./ShareMenu";
import { LanguageSwitcher } from "./LanguageSwitcher";
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

// Conversation chips and the live target only offer languages the realtime
// model can actually speak. The full 210+ language list lives in the header
// "My Page language" switcher, not here.
const REALTIME_LANGUAGES = LANGUAGES.filter((l) => l.realtime);
const APP_NAME = "AI Realtime Translate";

export default function Translator() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const t = useTranslator(audioRef);
  // UI translation: tx("English") → the chosen My Page language.
  const tx = useT();
  const uiLang = useUiLang();
  // On-demand text-to-speech: tap any finalized line to hear it spoken.
  const speech = useSpeech();
  // Vocabulary + grammar study built from the conversation, saved on-device.
  const study = useStudy();
  const [studyOpen, setStudyOpen] = useState(false);
  // Saved conversation logs + auto-generated minutes (localStorage for now).
  const convos = useConversations();
  const [logOpen, setLogOpen] = useState(false);
  const [myPageOpen, setMyPageOpen] = useState(false);
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
          // Keep at least one language in the conversation so single-language
          // sessions such as "Japanese only" are possible without ending up
          // with an empty output selection.
          return convLangs.length > 1
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
  // base language (when the realtime model can speak it); `targetOverride` holds
  // an explicit pick from the realtime-only selector.
  const [targetOverride, setTargetOverride] = useState<string | null>(null);
  const targetLang =
    targetOverride ??
    (baseLang && isRealtimeVoice(baseLang) ? baseLang : "ja");
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
  // Off by default in the conversation view; toggle it on from the footer.
  const [showReading, setShowReading] = useState(false);

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
      // Minutes are written in the reader's My Page language.
      lang: uiLang,
      segments: logged,
    });
  }, [t.segments, mode, convLangs, targetLang, uiLang, archiveConv, speakers]);

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

  // ---- Speaker diarization (only when Picovoice is configured) ----
  // Record the mic while we're listening; release the recorder when we stop.
  // With no AccessKey, `configured` is false and this never touches the mic —
  // the app runs exactly as it did before the feature existed.
  useEffect(() => {
    if (!diar.configured) return;
    if (t.activeStream) void diar.start(t.activeStream);
    else diar.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.activeStream, diar.configured]);

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

  // Compact view of the conversation for the study generator. Only optimized
  // (✨ refined) lines are included — feeding raw, pre-optimization text makes
  // the 単語帳 fill up with noisy, low-quality example sentences.
  const studyLines: StudyLine[] = useMemo(
    () =>
      t.segments
        .filter((s) => s.refined)
        .map((s) => ({
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
  const uiLangRef = useRef(uiLang);
  useEffect(() => {
    studyLinesRef.current = studyLines;
    accumulateRef.current = study.accumulate;
    uiLangRef.current = uiLang;
  });

  // Auto-accumulation: a few seconds after a line has been OPTIMIZED (not just
  // spoken), file any newly-optimized lines into the saved 単語帳 / 文法ノート.
  // Triggering on the optimized-line count (rather than the raw segment count)
  // means refinement, which finishes asynchronously after a line appears, is
  // what kicks this off — so only clean, optimized text reaches the 単語帳.
  // Dedup makes re-sends harmless.
  const studiedRef = useRef(0);
  useEffect(() => {
    const n = studyLines.length; // optimized (✨) lines only
    if (n < studiedRef.current) studiedRef.current = n; // history cleared
    if (!autoStudy || n <= studiedRef.current) return;
    const id = window.setTimeout(() => {
      const lines = studyLinesRef.current;
      if (lines.length <= studiedRef.current) return;
      const from = Math.max(0, studiedRef.current - 1); // 1 line of context
      studiedRef.current = lines.length;
      void accumulateRef.current(lines.slice(from), uiLangRef.current);
    }, 5000);
    return () => window.clearTimeout(id);
  }, [studyLines.length, autoStudy]);

  const micBlocked =
    micPerm === "denied" ||
    (!!t.error &&
      /microphone|permission|allow|secure|HTTPS|browser/i.test(t.error));

  const startLabel = connecting
    ? tx("Connecting…")
    : live
      ? tx("Stop")
      : mode === "talk"
        ? tx("Start conversation")
        : tx("Start translating");
  const recordButton = (className = "") => (
    <button
      className={`record ${live ? "on" : ""}${className ? ` ${className}` : ""}`}
      onClick={mode === "talk" ? onConvToggle : onLiveToggle}
      disabled={connecting}
    >
      <span className="record-icon" />
      {startLabel}
    </button>
  );

  return (
    <div className={`app${flipped ? " flipped" : ""}`}>
      <audio ref={audioRef} autoPlay playsInline />

      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" data-status={t.status} />
          <span className="brand-name">
            {optimizing
              ? `✨ ${tx("Optimizing the latest conversation…")}`
              : APP_NAME}
          </span>
        </div>
        <div className="topbar-right">
          <ShareMenu title={`${APP_NAME} — real-time multilingual translation`} />
          <LanguageSwitcher />
          <div className="seg">
            <button
              className={mode === "talk" ? "seg-btn on" : "seg-btn"}
              onClick={() => switchMode("talk")}
            >
              {tx("Conversation")}
            </button>
            <button
              className={mode === "live" ? "seg-btn on" : "seg-btn"}
              onClick={() => switchMode("live")}
            >
              {tx("Live")}
            </button>
          </div>
        </div>
      </header>

      {platform?.inApp && (
        <div className="banner warn" role="alert">
          ⚠️{" "}
          {tx(
            "The microphone isn’t available in {app}’s in-app browser. Open this page in Safari or Chrome from the menu at the top right.",
          ).replace("{app}", platform.inApp)}
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

      <div className="center-start" aria-label={startLabel}>
        {recordButton("record-center")}
      </div>

      <footer className="controls">
        <div className="options">
          {mode === "live" && (
            <button
              className={`audio-toggle ${t.audioOn ? "on" : ""}`}
              onClick={() => t.setAudioOn(!t.audioOn)}
              aria-pressed={t.audioOn}
            >
              <span className="audio-ico">{t.audioOn ? "🔊" : "🔇"}</span>
              {tx("Audio output")} {t.audioOn ? "ON" : "OFF"}
            </button>
          )}
          <button
            className={`audio-toggle ${showReading ? "on" : ""}`}
            onClick={() => setShowReading((v) => !v)}
            aria-pressed={showReading}
            title={tx("Show pronunciation (romaji, pinyin, IPA, etc.)")}
          >
            <span className="audio-ico">あ</span>
            {tx("Pronunciation")} {showReading ? "ON" : "OFF"}
          </button>
          <div className="insight-actions" aria-label={`${tx("Minutes")} / ${tx("Study")}`}>
            <button
              className="audio-toggle log-open"
              onClick={() => setLogOpen(true)}
              title={tx("View minutes and conversation logs")}
            >
              <span className="audio-ico">📝</span>
              {tx("Minutes")}
              {convos.conversations.length > 0 && (
                <span className="study-count">{convos.conversations.length}</span>
              )}
            </button>
            <button
              className="audio-toggle study-open"
              onClick={() => setStudyOpen(true)}
              title={tx("Learn words and grammar from this conversation")}
            >
              <span className="audio-ico">📚</span>
              {tx("Study")}
              {study.savedVocab.length > 0 && (
                <span className="study-count">{study.savedVocab.length}</span>
              )}
            </button>
          </div>
          <button
            className="audio-toggle mypage-open"
            onClick={() => setMyPageOpen(true)}
            title={tx("See your language levels")}
          >
            <span className="audio-ico">🧑‍🎓</span>
            {tx("My Page")}
          </button>
          <button
            className={`audio-toggle flip ${flipped ? "on" : ""}`}
            onClick={() => setFlipped((v) => !v)}
            aria-pressed={flipped}
            title={tx("Show to the other person (flip the screen)")}
          >
            <span className="audio-ico">🔄</span>
            {tx("Face them")}
          </button>
          {t.segments.length > 0 && (
            <button className="ghost" onClick={clearHistory}>
              {tx("Clear history")}
            </button>
          )}
          {live && (
            <button className="ghost danger" onClick={t.stop}>
              {tx("End")}
            </button>
          )}
        </div>

        <div className="live-controls">
          {recordButton()}
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
        study={study}
      />

      <MyPagePanel
        open={myPageOpen}
        onClose={() => setMyPageOpen(false)}
        study={study}
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
  const tx = useT();
  const [showAll, setShowAll] = useState(false);
  // Common languages up-front; the rest are shown only when "Show more" is
  // tapped — but a selected non-common language always stays visible. Only
  // realtime-capable languages are offered here.
  const shown = showAll
    ? REALTIME_LANGUAGES
    : REALTIME_LANGUAGES.filter((l) => l.common || selected.includes(l.code));
  const hiddenCount = REALTIME_LANGUAGES.length - shown.length;

  return (
    <div className="langchips-wrap">
      <button
        type="button"
        className="langchips-head"
        aria-expanded={open}
        onClick={onToggleOpen}
      >
        <span className="langchips-caret">{open ? "▾" : "▸"}</span>
        <span className="langchips-title">{tx("Languages")}</span>
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
              </button>
            );
          })}
          {(showAll || hiddenCount > 0) && (
            <button
              type="button"
              className="langchip more"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? `− ${tx("Close")}` : `＋ ${tx("Show more")} (${hiddenCount})`}
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
  const tx = useT();
  return (
    <div className="langbar live">
      <span className="live-arrow">{tx("Translate everything")} →</span>
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
  const tx = useT();
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
        aria-label={tx("Select language")}
      >
        {REALTIME_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} disabled={l.code === exclude}>
            {l.flag} {l.name}
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
  const tx = useT();
  const loading = speech.loadingKey === spKey;
  const playing = speech.playingKey === spKey;
  return (
    <button
      type="button"
      className={`speak-btn${playing ? " playing" : ""}`}
      aria-label={playing ? tx("Stop") : tx("Read aloud")}
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
  const tx = useT();
  const uiLang = useUiLang();
  const hasPartial =
    !!partialSource || Object.keys(partialTargets).length > 0;
  if (segments.length === 0 && !hasPartial) {
    return (
      <Empty
        title={
          convLangs.length === 1
            ? tx("Single-language conversation")
            : tx("Auto-translate across selected languages")
        }
        body={tx(
          convLangs.length === 1
            ? "Press “Start conversation” to listen in the language you picked. Add more languages any time to translate between them."
            : "Press “Start conversation” and speak in any selected language. We detect the spoken language automatically and translate it into the others.",
        )}
      />
    );
  }
  const sideOf = (lang: string) =>
    convLangs.indexOf(lang) % 2 === 0 ? "a" : "b";
  // Order translations with the reader's My Page language first, so their own
  // language shows at the top of every bubble.
  const orderFor = (src: string): string[] => {
    const others = convLangs.filter((l) => l !== src);
    return others.includes(uiLang)
      ? [uiLang, ...others.filter((l) => l !== uiLang)]
      : others;
  };
  const targetsOf = (
    src: string,
    map: Record<string, string>,
    keepEmpty: boolean,
    readings?: Record<string, string>,
  ): ChatTarget[] =>
    orderFor(src)
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
  const tx = useT();
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
            <span className="msg-badge" title={tx("Optimized with GPT-5.5")}>
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
  const tx = useT();
  const firstVal = (m: Record<string, string>) => Object.values(m)[0] ?? "";
  const firstKey = (m: Record<string, string>) => Object.keys(m)[0];
  const hasPartial =
    !!partialSource || Object.keys(partialTargets).length > 0;
  if (segments.length === 0 && !hasPartial) {
    return (
      <Empty
        title={tx("Live translation")}
        body={
          live
            ? tx("Speak — we translate what we hear in real time.")
            : tx(
                "Pick an output language and press “Start translating”. For talks, videos and more, we translate the audio you hear as subtitles.",
              )
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
  const tx = useT();
  const steps = isMicProblem && platform ? micFixSteps(platform) : [];
  return (
    <div className="michelp" role="alert">
      <div className="michelp-head">
        <span className="michelp-ico">🎤</span>
        {isMicProblem
          ? tx("Couldn’t access the microphone")
          : tx("Something went wrong")}
      </div>
      {message && <p className="michelp-msg">{tx(message)}</p>}
      {steps.length > 0 && (
        <ol className="michelp-steps">
          {steps.map((s, i) => (
            <li key={i}>{tx(s).replace("{app}", platform?.inApp ?? "")}</li>
          ))}
        </ol>
      )}
      <div className="michelp-actions">
        <button className="michelp-btn primary" onClick={onRetry}>
          {tx("Try again")}
        </button>
        <button
          className="michelp-btn"
          onClick={() => window.location.reload()}
        >
          {tx("Reload")}
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
