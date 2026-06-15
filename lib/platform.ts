// Lightweight client-side environment detection used to give the user
// targeted, actionable guidance when microphone access fails.

export type OS = "ios" | "android" | "other";
export type Browser = "chrome" | "safari" | "firefox" | "edge" | "other";

export interface Platform {
  os: OS;
  browser: Browser;
  /** Name of a known in-app browser (LINE, Instagram, …) or null. */
  inApp: string | null;
  /** getUserMedia available in a secure context. */
  micSupported: boolean;
}

const IN_APP_RULES: [string, RegExp][] = [
  ["LINE", /\bLine\//i],
  ["Facebook", /FBAN|FBAV|FB_IAB/i],
  ["Messenger", /Messenger/i],
  ["Instagram", /Instagram/i],
  ["X (Twitter)", /Twitter/i],
  ["WeChat", /MicroMessenger/i],
  ["KakaoTalk", /KAKAOTALK/i],
  ["TikTok", /musical_ly|BytedanceWebview|TikTok/i],
  ["Slack", /Slack/i],
];

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") {
    return { os: "other", browser: "other", inApp: null, micSupported: false };
  }
  const ua = navigator.userAgent || "";

  const os: OS = /iPhone|iPad|iPod/i.test(ua)
    ? "ios"
    : /Android/i.test(ua)
      ? "android"
      : "other";

  let browser: Browser = "other";
  if (/CriOS|Chrome/i.test(ua) && !/Edg|OPR|SamsungBrowser/i.test(ua)) {
    browser = "chrome";
  } else if (/FxiOS|Firefox/i.test(ua)) {
    browser = "firefox";
  } else if (/EdgiOS|Edg/i.test(ua)) {
    browser = "edge";
  } else if (/Safari/i.test(ua)) {
    browser = "safari";
  }

  let inApp: string | null = null;
  for (const [name, re] of IN_APP_RULES) {
    if (re.test(ua)) {
      inApp = name;
      break;
    }
  }

  const micSupported =
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    (typeof window === "undefined" || window.isSecureContext);

  return { os, browser, inApp, micSupported };
}

export type MicPermission = "granted" | "denied" | "prompt" | "unknown";

/** Best-effort read of the current microphone permission state. */
export async function getMicPermission(): Promise<MicPermission> {
  try {
    const perms = navigator.permissions;
    if (!perms?.query) return "unknown";
    // `microphone` isn't in older TS lib DOM types — cast the name.
    const status = await perms.query({
      name: "microphone" as PermissionName,
    });
    return status.state as MicPermission;
  } catch {
    return "unknown";
  }
}

/** OS/browser-specific steps to re-enable a blocked microphone. */
export function micFixSteps(p: Platform): string[] {
  if (p.inApp) {
    return [
      `${p.inApp} のアプリ内ブラウザではマイクを使えません。`,
      "右上のメニューから「Safari / Chrome で開く」を選び、通常のブラウザで開き直してください。",
    ];
  }
  if (p.os === "ios" && p.browser === "chrome") {
    return [
      "iPhoneの「設定」→「Chrome」→「マイク」をオンにする",
      "Chromeに戻ってページを再読み込みし、表示される確認で「許可」を選ぶ",
    ];
  }
  if (p.os === "ios") {
    return [
      "アドレスバー左の「ぁあ」→「Webサイトの設定」→「マイク」→「許可」",
      "または「設定」→「Safari」→「カメラとマイクのアクセス」をオン → 再読み込み",
    ];
  }
  if (p.os === "android") {
    return [
      "アドレスバーの 🔒（または ⓘ）→「権限」→「マイク」→「許可」",
      "直らなければ「設定」→「アプリ」→ ブラウザ →「権限」→「マイク」を許可 → 再読み込み",
    ];
  }
  return [
    "アドレスバーの 🔒 をタップ →「マイク」を「許可」に変更",
    "ページを再読み込みして、もう一度お試しください",
  ];
}
