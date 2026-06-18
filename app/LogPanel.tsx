"use client";

import { useEffect, useState } from "react";
import { getLanguage } from "@/lib/languages";
import { useT } from "@/lib/i18n";
import type { Conversation, useConversations } from "@/lib/useConversations";
import { SpeakerTag } from "./SpeakerTag";
import { ShareMenu } from "./ShareMenu";

type Convos = ReturnType<typeof useConversations>;

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

// A short title to share, and the full minutes rendered as plain text to copy.
function minutesTitle(conv: Conversation, fallback: string): string {
  return conv.minutes?.title || fallback;
}
function minutesText(conv: Conversation, title: string): string {
  const m = conv.minutes;
  if (!m) return title;
  const lines: string[] = [`📝 ${title}`];
  if (m.summary) lines.push("", m.summary);
  const section = (head: string, items?: string[]) => {
    if (items && items.length) {
      lines.push("", head, ...items.map((i) => `・${i}`));
    }
  };
  section("Topics", m.topics);
  section("Decisions", m.decisions);
  section("To-dos", m.actions);
  return lines.join("\n");
}

export function LogPanel({
  open,
  onClose,
  convos,
}: {
  open: boolean;
  onClose: () => void;
  convos: Convos;
}) {
  const tx = useT();
  // When set, we're viewing one conversation's full chat history.
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
                  aria-label={tx("Back to list")}
                >
                  ‹
                </button>
                💬 {tx("Conversation log")}
              </>
            ) : (
              `📝 ${tx("Minutes")}`
            )}
          </h2>
          <div className="study-head-right">
            {!selected && list.length > 0 && (
              <button
                className="study-auto"
                onClick={() => {
                  if (
                    window.confirm(
                      tx("Delete all saved minutes and conversation logs?"),
                    )
                  ) {
                    convos.clearAll();
                  }
                }}
                title={tx("Delete everything")}
              >
                {tx("Clear all")}
              </button>
            )}
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
          {selected ? (
            <DetailView
              conv={selected}
              onRegenerate={() => convos.generateMinutes(selected.id)}
            />
          ) : list.length === 0 ? (
            <p className="study-empty">
              {tx(
                "No minutes yet. When you end a conversation it’s saved automatically and its minutes are generated.",
              )}
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

/* ---------------- Minutes card (list) ---------------- */

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
  const tx = useT();
  const m = conv.minutes;
  const title =
    m?.title ||
    tx(conv.mode === "talk" ? "Conversation record" : "Live record");
  return (
    <div className="logcard">
      <div className="logcard-top">
        <span className="logcard-title">{title}</span>
        <ShareMenu
          title={minutesTitle(conv, title)}
          body={minutesText(conv, title)}
        />
        <button
          type="button"
          className="study-remove"
          onClick={onRemove}
          aria-label={tx("Delete")}
        >
          🗑
        </button>
      </div>

      <div className="logcard-meta">
        <span>{fmtDate(conv.endedAt)}</span>
        <span className="logcard-flags">
          {conv.langs.map((l) => getLanguage(l).flag).join(" ")}
        </span>
        <span>
          {conv.segments.length} {tx("lines")}
        </span>
      </div>

      {conv.minutesStatus === "generating" && (
        <p className="logcard-status">✨ {tx("Generating minutes…")}</p>
      )}
      {conv.minutesStatus === "error" && (
        <div className="logcard-status err">
          {tx(conv.minutesError ?? "Failed to generate the minutes.")}
          <button type="button" className="logcard-retry" onClick={onRegenerate}>
            {tx("Retry")}
          </button>
        </div>
      )}
      {m && (
        <div className="minutes">
          {m.summary && <p className="minutes-summary">{m.summary}</p>}
          <MinutesSection title={tx("Topics")} items={m.topics} />
          <MinutesSection title={tx("Decisions")} items={m.decisions} />
          <MinutesSection title={tx("To-dos / next actions")} items={m.actions} />
        </div>
      )}

      <button type="button" className="log-open-chat" onClick={onOpen}>
        💬 {tx("See the full conversation log")} ({conv.segments.length}{" "}
        {tx("lines")})
      </button>
    </div>
  );
}

/* ---------------- Detail (minutes + chat history) ---------------- */

function DetailView({
  conv,
  onRegenerate,
}: {
  conv: Conversation;
  onRegenerate: () => void;
}) {
  const tx = useT();
  const m = conv.minutes;
  const title =
    m?.title ||
    tx(conv.mode === "talk" ? "Conversation record" : "Live record");
  return (
    <div className="log-detail">
      <div className="log-detail-head">
        <h3 className="log-detail-title">{title}</h3>
        <ShareMenu
          title={minutesTitle(conv, title)}
          body={minutesText(conv, title)}
        />
      </div>
      <div className="logcard-meta">
        <span>{fmtDate(conv.endedAt)}</span>
        <span className="logcard-flags">
          {conv.langs.map((l) => getLanguage(l).flag).join(" ")}
        </span>
        <span>
          {conv.segments.length} {tx("lines")}
        </span>
      </div>

      {m && (
        <div className="minutes">
          {m.summary && <p className="minutes-summary">{m.summary}</p>}
          <MinutesSection title={tx("Topics")} items={m.topics} />
          <MinutesSection title={tx("Decisions")} items={m.decisions} />
          <MinutesSection title={tx("To-dos / next actions")} items={m.actions} />
          <button type="button" className="logcard-retry alt" onClick={onRegenerate}>
            🔄 {tx("Regenerate minutes")}
          </button>
        </div>
      )}

      <h4 className="log-chat-head">{tx("Conversation history")}</h4>
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
              {s.speaker ? <SpeakerTag n={s.speaker} /> : null}
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
