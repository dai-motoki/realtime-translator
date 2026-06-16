"use client";

import { useEffect, useState } from "react";
import { getLanguage } from "@/lib/languages";
import type { Conversation, useConversations } from "@/lib/useConversations";

type Convos = ReturnType<typeof useConversations>;

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function LogPanel({
  open,
  onClose,
  convos,
}: {
  open: boolean;
  onClose: () => void;
  convos: Convos;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

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

  const list = convos.conversations;

  return (
    <div className="study-overlay" role="dialog" aria-modal="true">
      <div className="study-backdrop" onClick={onClose} />
      <div className="study-sheet">
        <header className="study-head">
          <h2 className="study-title">🗂 会話ログ・議事録</h2>
          <div className="study-head-right">
            {list.length > 0 && (
              <button
                className="study-auto"
                onClick={() => {
                  if (window.confirm("保存した会話ログをすべて削除しますか？")) {
                    convos.clearAll();
                  }
                }}
                title="すべての会話ログを削除"
              >
                全消去
              </button>
            )}
            <button className="study-close" onClick={onClose} aria-label="閉じる">
              ✕
            </button>
          </div>
        </header>

        <div className="study-body">
          {list.length === 0 ? (
            <p className="study-empty">
              まだ保存された会話はありません。会話を終了すると、その内容が自動で保存され、議事録も自動で作成されます。
            </p>
          ) : (
            <div className="study-list">
              {list.map((c) => (
                <LogCard
                  key={c.id}
                  conv={c}
                  open={expanded === c.id}
                  onToggle={() =>
                    setExpanded((id) => (id === c.id ? null : c.id))
                  }
                  onRegenerate={() => convos.generateMinutes(c.id)}
                  onRemove={() => {
                    if (expanded === c.id) setExpanded(null);
                    convos.remove(c.id);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LogCard({
  conv,
  open,
  onToggle,
  onRegenerate,
  onRemove,
}: {
  conv: Conversation;
  open: boolean;
  onToggle: () => void;
  onRegenerate: () => void;
  onRemove: () => void;
}) {
  const m = conv.minutes;
  const title = m?.title || `${conv.mode === "talk" ? "会話" : "ライブ"}の記録`;
  return (
    <div className="logcard">
      <div className="logcard-top">
        <button type="button" className="logcard-head" onClick={onToggle}>
          <span className="logcard-caret">{open ? "▾" : "▸"}</span>
          <span className="logcard-title">{title}</span>
        </button>
        <button
          type="button"
          className="study-remove"
          onClick={onRemove}
          aria-label="削除"
        >
          🗑
        </button>
      </div>

      <div className="logcard-meta">
        <span>{fmtDate(conv.endedAt)}</span>
        <span className="logcard-flags">
          {conv.langs.map((l) => getLanguage(l).flag).join(" ")}
        </span>
        <span>{conv.segments.length}行</span>
      </div>

      {/* Minutes (議事録) */}
      {conv.minutesStatus === "generating" && (
        <p className="logcard-status">✨ 議事録を作成中…</p>
      )}
      {conv.minutesStatus === "error" && (
        <div className="logcard-status err">
          {conv.minutesError ?? "議事録の生成に失敗しました。"}
          <button
            type="button"
            className="logcard-retry"
            onClick={onRegenerate}
          >
            再試行
          </button>
        </div>
      )}
      {m && (
        <div className="minutes">
          {m.summary && <p className="minutes-summary">{m.summary}</p>}
          <MinutesSection title="論点・トピック" items={m.topics} />
          <MinutesSection title="決定事項" items={m.decisions} />
          <MinutesSection title="ToDo・次のアクション" items={m.actions} />
          <button
            type="button"
            className="logcard-retry alt"
            onClick={onRegenerate}
          >
            🔄 議事録を作り直す
          </button>
        </div>
      )}

      {open && (
        <div className="logcard-transcript">
          {conv.segments.map((s, i) => (
            <div key={i} className="logline">
              <p className="logline-src">
                <span aria-hidden>
                  {s.sourceLang ? getLanguage(s.sourceLang).flag : "💬"}
                </span>{" "}
                {s.source}
              </p>
              {Object.entries(s.targets).map(([lang, text]) => (
                <p key={lang} className="logline-tgt">
                  <span aria-hidden>{getLanguage(lang).flag}</span> {text}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MinutesSection({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="minutes-section">
      <h4 className="minutes-h">{title}</h4>
      <ul className="minutes-ul">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
