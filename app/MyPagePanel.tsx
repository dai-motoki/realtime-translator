"use client";

import { useEffect, useMemo } from "react";
import { getLanguage } from "@/lib/languages";
import { useT } from "@/lib/i18n";
import {
  exampleList,
  type useStudy,
  type VocabItem,
  type GrammarItem,
} from "@/lib/useStudy";
import { useStudyLog, type ViewEvent } from "@/lib/studyLog";

type Study = ReturnType<typeof useStudy>;

const DAY = 86400000;
const TREND_DAYS = 14;

const startOfDay = (t: number): number => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

interface Trend {
  /** Study seconds per day, oldest → today (length TREND_DAYS). */
  daily: number[];
  /** Minutes studied in the last 7 days. */
  weekMin: number;
  /** Growth vs the previous 7 days, as a percentage (null when no baseline). */
  growthPct: number | null;
  /** Days since the language was last studied (null when never). */
  lastDays: number | null;
}

function trendFor(lang: string, events: ViewEvent[]): Trend {
  const today = startOfDay(Date.now());
  const daily = new Array<number>(TREND_DAYS).fill(0);
  let last = 0;
  for (const ev of events) {
    if (ev.lang !== lang) continue;
    if (ev.t > last) last = ev.t;
    const diff = Math.round((today - startOfDay(ev.t)) / DAY);
    if (diff >= 0 && diff < TREND_DAYS) daily[TREND_DAYS - 1 - diff] += ev.ms / 1000;
  }
  const recent7 = daily.slice(TREND_DAYS - 7).reduce((s, x) => s + x, 0);
  const prev7 = daily.slice(0, TREND_DAYS - 7).reduce((s, x) => s + x, 0);
  const growthPct =
    prev7 > 0
      ? Math.round(((recent7 - prev7) / prev7) * 100)
      : recent7 > 0
        ? 100
        : null;
  return {
    daily,
    weekMin: Math.round(recent7 / 60),
    growthPct,
    lastDays: last ? Math.floor((Date.now() - last) / DAY) : null,
  };
}

function Sparkline({ data }: { data: number[] }) {
  const w = 150;
  const h = 30;
  const max = Math.max(1, ...data);
  const bw = w / data.length;
  return (
    <svg
      className="mypage-spark"
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      aria-hidden
    >
      {data.map((v, i) => {
        const bh = Math.max(v > 0 ? 2 : 0, (v / max) * (h - 2));
        return (
          <rect
            key={i}
            className="mypage-spark-bar"
            x={i * bw + 1}
            y={h - bh}
            width={bw - 2}
            height={bh}
            rx={1}
          />
        );
      })}
    </svg>
  );
}

// Recent-activity row under a language's radar: a 14-day sparkline, minutes this
// week (with growth vs last week) and how long since you last studied it.
function TrendRow({ lang, log }: { lang: string; log: ViewEvent[] }) {
  const tx = useT();
  const trend = useMemo(() => trendFor(lang, log), [lang, log]);
  if (trend.weekMin === 0 && trend.lastDays === null) return null;

  const growth = trend.growthPct;
  const growthStr =
    growth === null ? "" : `${growth >= 0 ? "▲" : "▼"}${Math.abs(growth)}%`;
  const last =
    trend.lastDays === null
      ? "—"
      : trend.lastDays <= 0
        ? tx("today")
        : tx("{n}d ago").replace("{n}", String(trend.lastDays));

  return (
    <div className="mypage-trend">
      <Sparkline data={trend.daily} />
      <div className="mypage-trend-meta">
        <span>
          📈 {trend.weekMin} {tx("min this week")}{" "}
          {growthStr && (
            <span className={growth! >= 0 ? "trend-up" : "trend-down"}>
              {growthStr}
            </span>
          )}
        </span>
        <span className="mypage-last">
          🕒 {tx("Last studied")}: {last}
        </span>
      </div>
    </div>
  );
}

// The six radar axes. Each raw value is mapped to a 0–100 level on a log scale
// against a heuristic "advanced learner" target, so the shape reflects an
// absolute level (not just relative to your other languages).
interface AxisDef {
  key: string;
  label: string;
  target: number;
}

const lvl = (value: number, target: number): number =>
  Math.round(100 * Math.min(1, Math.log1p(value) / Math.log1p(target)));

interface LangStats {
  lang: string;
  words: number;
  grammars: number;
  axes: { label: string; value: number }[];
  overall: number;
}

function statsFor(
  lang: string,
  vocab: VocabItem[],
  grammar: GrammarItem[],
  axisDefs: AxisDef[],
): LangStats {
  const v = vocab.filter((x) => x.lang === lang);
  const g = grammar.filter((x) => x.lang === lang);
  const all = [...v, ...g];

  const dwellSec = all.reduce((s, x) => s + (x.dwell ?? 0), 0) / 1000;
  const encounters = all.reduce((s, x) => s + (x.count ?? 1), 0);
  const examples = all.reduce((s, x) => s + exampleList(x).length, 0);
  // "Mastery": items you've actually engaged with for a while (≥ 8s total).
  const mastered = all.filter((x) => (x.dwell ?? 0) >= 8000).length;

  const raw: Record<string, number> = {
    vocab: v.length,
    grammar: g.length,
    time: dwellSec,
    repetition: encounters,
    examples,
    mastery: mastered,
  };

  const axes = axisDefs.map((a) => ({
    label: a.label,
    value: lvl(raw[a.key] ?? 0, a.target),
  }));
  const overall = Math.round(
    axes.reduce((s, a) => s + a.value, 0) / (axes.length || 1),
  );
  return { lang, words: v.length, grammars: g.length, axes, overall };
}

/** Vertices of a regular hexagon (radius r), first axis pointing up. */
function hexPoints(
  cx: number,
  cy: number,
  r: number,
  values: number[],
): string {
  return values
    .map((val, i) => {
      const ang = -Math.PI / 2 + (i * Math.PI) / 3; // 60° steps from top
      const rr = (r * val) / 100;
      return `${(cx + rr * Math.cos(ang)).toFixed(1)},${(cy + rr * Math.sin(ang)).toFixed(1)}`;
    })
    .join(" ");
}

function RadarChart({ axes }: { axes: { label: string; value: number }[] }) {
  const size = 260;
  const cx = size / 2;
  const cy = size / 2;
  const r = 88;
  const rings = [25, 50, 75, 100];
  const full = axes.map(() => 100);

  return (
    <svg
      className="radar"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      width={size}
      height={size}
    >
      {/* grid rings */}
      {rings.map((ring) => (
        <polygon
          key={ring}
          className="radar-grid"
          points={hexPoints(
            cx,
            cy,
            r,
            full.map(() => ring),
          )}
        />
      ))}
      {/* spokes */}
      {axes.map((_, i) => {
        const ang = -Math.PI / 2 + (i * Math.PI) / 3;
        return (
          <line
            key={i}
            className="radar-spoke"
            x1={cx}
            y1={cy}
            x2={cx + r * Math.cos(ang)}
            y2={cy + r * Math.sin(ang)}
          />
        );
      })}
      {/* data polygon */}
      <polygon
        className="radar-area"
        points={hexPoints(
          cx,
          cy,
          r,
          axes.map((a) => a.value),
        )}
      />
      {/* axis labels + values */}
      {axes.map((a, i) => {
        const ang = -Math.PI / 2 + (i * Math.PI) / 3;
        const lx = cx + (r + 20) * Math.cos(ang);
        const ly = cy + (r + 20) * Math.sin(ang);
        const anchor =
          Math.abs(Math.cos(ang)) < 0.3
            ? "middle"
            : Math.cos(ang) > 0
              ? "start"
              : "end";
        return (
          <text
            key={i}
            className="radar-label"
            x={lx}
            y={ly}
            textAnchor={anchor}
            dominantBaseline="middle"
          >
            <tspan>{a.label}</tspan>
            <tspan className="radar-val" x={lx} dy="13">
              {a.value}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}

export function MyPagePanel({
  open,
  onClose,
  study,
}: {
  open: boolean;
  onClose: () => void;
  study: Study;
}) {
  const tx = useT();
  const log = useStudyLog();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const axisDefs: AxisDef[] = useMemo(
    () => [
      { key: "vocab", label: tx("Vocabulary"), target: 300 },
      { key: "grammar", label: tx("Grammar"), target: 120 },
      { key: "time", label: tx("Study time"), target: 3600 },
      { key: "repetition", label: tx("Repetition"), target: 600 },
      { key: "examples", label: tx("Examples"), target: 500 },
      { key: "mastery", label: tx("Mastery"), target: 150 },
    ],
    [tx],
  );

  const langs = useMemo(() => {
    const set = new Set<string>();
    for (const v of study.savedVocab) if (v.lang) set.add(v.lang);
    for (const g of study.savedGrammar) if (g.lang) set.add(g.lang);
    const stats = [...set].map((l) =>
      statsFor(l, study.savedVocab, study.savedGrammar, axisDefs),
    );
    // Strongest languages first.
    stats.sort((a, b) => b.overall - a.overall);
    return stats;
  }, [study.savedVocab, study.savedGrammar, axisDefs]);

  if (!open) return null;

  return (
    <div className="study-overlay" role="dialog" aria-modal="true">
      <div className="study-backdrop" onClick={onClose} />
      <div className="study-sheet">
        <header className="study-head">
          <h2 className="study-title">🧑‍🎓 {tx("My Page")}</h2>
          <div className="study-head-right">
            <button
              className="study-close"
              onClick={onClose}
              aria-label={tx("Close")}
            >
              ✕
            </button>
          </div>
        </header>

        <div className="study-body">
          <p className="mypage-intro">
            {tx(
              "Your level in each language, estimated from how much you've studied (time spent, words, grammar, examples and review).",
            )}
          </p>
          {langs.length === 0 ? (
            <p className="study-empty">
              {tx(
                "No study data yet. Collect some words and grammar first, then come back to see your levels.",
              )}
            </p>
          ) : (
            langs.map((s) => {
              const l = getLanguage(s.lang);
              return (
                <section className="mypage-lang" key={s.lang}>
                  <div className="mypage-lang-head">
                    <span className="mypage-flag" aria-hidden>
                      {l.flag}
                    </span>
                    <span className="mypage-lang-name">{l.name}</span>
                    <span className="mypage-overall" title={tx("Overall level")}>
                      Lv {s.overall}
                    </span>
                  </div>
                  <RadarChart axes={s.axes} />
                  <div className="mypage-counts">
                    {s.words} {tx("words")} · {s.grammars} {tx("Grammar")}
                  </div>
                  <TrendRow lang={s.lang} log={log} />
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
