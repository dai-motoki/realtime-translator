# Realtime Translate 🌐

スマホネイティブUIの**リアルタイム多言語音声翻訳**Webアプリ。話した言葉をその場で別の言語の**音声＋字幕**に翻訳します。

OpenAI の専用モデル [`gpt-realtime-translate`](https://developers.openai.com/api/docs/models/gpt-realtime-translate) を、ブラウザから **WebRTC** で直接利用します（入力音声は70以上の言語を自動検出）。

## 特長

- **リアルタイム字幕がメイン** — 話した内容をその場で文字に起こして翻訳表示。**音声出力はワンタップでON/OFF**（既定はOFF）。
- **会話モード（自動双方向 / LINE風チャット）** — 「会話を始める」を押したら、あとは日本語でも英語でもそのまま話すだけ。話した言語を自動判定して相手の言語へ翻訳し、**原文（上）＋訳文（下）を一文ごとに対応づけた吹き出し**を、話者の言語で左右に振り分けて表示します（ボタンの押し分け不要・マイク許可は1回だけ）。
- **ライブモード** — 講演・動画・会議など、聞こえてくる音声をひとつの言語へ連続翻訳（テロップ表示）。
- **低遅延 / S2S** — STT→翻訳→TTSの分割ではなく、音声をそのまま翻訳。音声出力ON時は声のトーンも引き継がれます。
- **スマホ最適化** — iOS/Android のモバイルWebで動作（マイクはタップ操作の直後に取得）。セーフエリア対応・大きなタップ領域・PWA対応。
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
| `MINUTES_MODEL` | （任意）議事録生成のモデル。既定は `REFINE_MODEL` → `gpt-5.5`。 |
| `NEXT_PUBLIC_PICOVOICE_ACCESS_KEY` | （任意）話者識別を有効化。未設定なら機能オフ。 |
| `NEXT_PUBLIC_FALCON_MODEL_PATH` | （任意）Falconモデルの配置パス。既定 `/models/falcon_params.pv`。 |

### 話者識別（話者分離）の有効化 — 任意

会話ログ・議事録に「話者1 / 話者2 …」を自動で付けられます。声色から話者を推定する [Picovoice Falcon](https://picovoice.ai/platform/falcon/) をブラウザ内（WASM）で実行するため、**音声は端末外に出ません**。登録は不要で、会話が数秒たまるたびに録音全体を再クラスタリングし、ラベルを擬似リアルタイムに反映します。

1. [Picovoice Console](https://console.picovoice.ai/) で無料の **AccessKey** を取得し、`NEXT_PUBLIC_PICOVOICE_ACCESS_KEY` に設定。
2. モデル [`falcon_params.pv`](https://github.com/Picovoice/falcon/tree/main/lib/common) をダウンロードし、`public/models/falcon_params.pv` に配置。

未設定のままなら話者ラベルは出ず、アプリは従来通り動作します。

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
