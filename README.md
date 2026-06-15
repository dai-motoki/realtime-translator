# Realtime Translate 🌐

スマホネイティブUIの**リアルタイム多言語音声翻訳**Webアプリ。話した言葉をその場で別の言語の**音声＋字幕**に翻訳します。

OpenAI の専用モデル [`gpt-realtime-translate`](https://developers.openai.com/api/docs/models/gpt-realtime-translate) を、ブラウザから **WebRTC** で直接利用します（入力音声は70以上の言語を自動検出）。

## 特長

- **会話モード** — 2言語をタップで切り替える対面翻訳。話す側のボタンを押して話すと、相手の言語に翻訳した音声が流れ、字幕がチャット形式で残ります。
- **ライブモード** — 講演・動画・会議など、聞こえてくる音声をひとつの言語へ連続翻訳（テロップ表示）。
- **低遅延 / S2S** — STT→翻訳→TTSの分割ではなく、音声をそのまま音声へ翻訳。声のトーンも引き継がれます。
- **スマホネイティブUI** — セーフエリア対応・大きなタップ領域・PWA対応（ホーム画面に追加でフルスクリーン）。
- **APIキーは漏れない** — サーバ側で短命の ephemeral client secret を発行し、ブラウザには標準APIキーを渡しません。

## 仕組み

```
ブラウザ ──POST /api/session──▶ Next.js Route Handler ──▶ OpenAI
  │                              (OPENAI_API_KEY で client_secret 発行)
  │◀── ephemeral client secret ──┘
  │
  └─ WebRTC (SDP) ──▶ https://api.openai.com/v1/realtime/translations/calls
        マイク音声を送信 ／ 翻訳音声トラック＋字幕デルタを受信
```

- トークン発行: `POST /v1/realtime/translations/client_secrets`（モデル `gpt-realtime-translate`）
- 接続: `POST /v1/realtime/translations/calls`（`oai-events` データチャネル）
- 出力言語の切替: `session.update` の `audio.output.language`
- 受信イベント: `session.input_transcript.delta`（原文）/ `session.output_transcript.delta`（訳文）

## セットアップ

```bash
pnpm install
cp .env.example .env.local   # OPENAI_API_KEY を設定
pnpm dev
```

[http://localhost:3000](http://localhost:3000) を開く（マイク利用のため `localhost` または HTTPS が必要）。

### 環境変数

| 変数 | 用途 |
| --- | --- |
| `OPENAI_API_KEY` | サーバ側のみ。Realtime translation の client secret 発行に使用。 |

## Vercel へのデプロイ

このリポジトリを Vercel に接続し、Environment Variables に `OPENAI_API_KEY` を追加するだけです（ビルド設定はNext.js標準）。

```bash
vercel --prod
```

## 技術スタック

Next.js 16 (App Router) / React 19 / TypeScript / WebRTC / OpenAI `gpt-realtime-translate`。UIは依存ライブラリなしの自作CSS。

## メモ

- 入力言語は自動検出されるため、話す言語を選ぶ必要はありません（選ぶのは「翻訳先」だけ）。
- 出力対応言語はアプリ内の13言語。`lib/languages.ts` で増減できます。
- 課金は音声時間に対して発生します（モデル料金は OpenAI の料金表を参照）。
