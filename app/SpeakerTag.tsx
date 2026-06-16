"use client";

// Distinct, legible accent per diarized speaker (cycles if there are many).
export const SPEAKER_COLORS = [
  "#6c8cff",
  "#2bd9a0",
  "#ffb84d",
  "#ff7ab8",
  "#a06bff",
  "#4dd0e1",
];

/** A small "話者N" chip shown when speaker diarization has labeled a line. */
export function SpeakerTag({ n }: { n?: number }) {
  if (!n || n < 1) return null;
  const color = SPEAKER_COLORS[(n - 1) % SPEAKER_COLORS.length];
  return (
    <span className="speaker-tag" style={{ color }}>
      <span className="speaker-dot" style={{ background: color }} />
      話者{n}
    </span>
  );
}
