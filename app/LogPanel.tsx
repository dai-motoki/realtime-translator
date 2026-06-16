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
  // When set, we're viewing one conversation's full chat history (会話ログ).
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Close on Escape (or step back out of a detail view first).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selectedId) setSelectedId(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, selectedId]);

  if (!open) return null;

  const list = convos.conversations;
  const selected = selectedId
    ? list.find((c) => c.id === selectedId) ?? null
    : null;

  return (
    <div className="study-overlay" role="dialog" aria-modal="true">
      <div className="study-backdrop" onClick={onClose} />
      <div className="study-sheet">
        <header className="study-head">
          <h2 className="study-title">
            {selected ? (
              <>
                <button
                  className="log-back"
                  onClick={() => setSelectedId(null)}
                  aria-label="一覧に戻る"
                >
                  ‹
                </button>
                💬 会話ログ
              </>
            ) : (
              "📝 議事録"
            )}
          </h2>
          <div className="study-head-right">
            {!selected && list.length > 0 && (
              <button
                className="study-auto"
                onClick={() => {
                  if (window.confirm("保存した議事録・会話ログをすべて削除しますか？")) {
                    convos.clearAll();
                  }
                }}
                title="すべて削除"
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
          {selected ? (
            <DetailView
              conv={selected}
              onRegenerate={() => convos.generateMinutes(selected.id)}
            />
          ) : list.length === 0 ? (
            <p className="study-empty">
              まだ議事録はありません。会話を終了すると、その内容が自動で保存され、議事録も自動で作成されます。
            </p>
          ) : (
            <div className="study-list">
              {list.map((c) => (
                <MinutesCard
                  key={c.id}
                  conv={c}
                  onOpen={() => setSelectedId(c.id)}
                  onRegenerate={() => convos.generateMinutes(c.id)}
                  onRemove={() => convos.remove(c.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- 議事録カード（一覧） ---------------- */

function MinutesCard({
  conv,
  onOpen,
  onRegenerate,
  onRemove,
}: {
  conv: Conversation;
  onOpen: () => void;
  onRegenerate: () => void;
  onRemove: () => void;
}) {
  const m = conv.minutes;
  const title = m?.title || `${conv.mode === "talk" ? "会話" : "ライブ"}の記録`;
  return (
    <div className="logcard">
      <div className="logcard-top">
        <span className="logcard-title">{title}</span>
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

      {conv.minutesStatus === "generating" && (
        <p className="logcard-status">✨ 議事録を作成中…</p>
      )}
      {conv.minutesStatus === "error" && (
        <div className="logcard-status err">
          {conv.minutesError ?? "議事録の生成に失敗しました。"}
          <button type="button" className="logcard-retry" onClick={onRegenerate}>
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
        </div>
      )}

      <button type="button" className="log-open-chat" onClick={onOpen}>
        💬 会話ログを全部見る（{conv.segments.length}行）
      </button>
    </div>
  );
}

/* ---------------- 詳細（議事録＋会話チャット履歴） ---------------- */

function DetailView({
  conv,
  onRegenerate,
}: {
  conv: Conversation;
  onRegenerate: () => void;
}) {
  const m = conv.minutes;
  const title = m?.title || `${conv.mode === "talk" ? "会話" : "ライブ"}の記録`;
  return (
    <div className="log-detail">
      <h3 className="log-detail-title">{title}</h3>
      <div className="logcard-meta">
        <span>{fmtDate(conv.endedAt)}</span>
        <span className="logcard-flags">
          {conv.langs.map((l) => getLanguage(l).flag).join(" ")}
        </span>
        <span>{conv.segments.length}行</span>
      </div>

      {m && (
        <div className="minutes">
          {m.summary && <p className="minutes-summary">{m.summary}</p>}
          <MinutesSection title="論点・トピック" items={m.topics} />
          <MinutesSection title="決定事項" items={m.decisions} />
          <MinutesSection title="ToDo・次のアクション" items={m.actions} />
          <button type="button" className="logcard-retry alt" onClick={onRegenerate}>
            🔄 議事録を作り直す
          </button>
        </div>
      )}

      <h4 className="log-chat-head">会話チャット履歴</h4>
      <ChatHistory conv={conv} />
    </div>
  );
}

/** Read-only replay of the saved conversation as LINE-style chat bubbles. */
function ChatHistory({ conv }: { conv: Conversation }) {
  const langs = conv.langs;
  const sideOf = (lang: string) =>
    langs.indexOf(lang) % 2 === 0 ? "a" : "b";
  return (
    <div className="chat">
      {conv.segments.map((s, i) => {
        const src = s.sourceLang ?? langs[0] ?? "";
        const targets = langs
          .filter((l) => l !== src)
          .map((l) => ({
            lang: l,
            text: s.targets[l] ?? "",
            reading: s.readings?.[l],
          }))
          .filter((x) => x.text);
        return (
          <div key={i} className={`msg ${sideOf(src)}`}>
            <span className="msg-avatar" aria-hidden>
              {src ? getLanguage(src).flag : "💬"}
            </span>
            <div className="msg-bubble">
              <p className="msg-main">{s.source || "…"}</p>
              {s.sourceReading && <p className="msg-reading">{s.sourceReading}</p>}
              {targets.map((tg) => (
                <div key={tg.lang} className="msg-trans-block">
                  <p className="msg-trans">
                    <span className="msg-trans-flag" aria-hidden>
                      {getLanguage(tg.lang).flag}
                    </span>
                    {tg.text}
                  </p>
                  {tg.reading && <p className="msg-reading sub">{tg.reading}</p>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
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
