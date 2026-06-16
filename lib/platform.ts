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

/**
 * OS/browser-specific steps to re-enable a blocked microphone. Returned in
 * English (the app's source language); the UI translates each step via i18n.
 * The in-app step keeps a {app} placeholder the UI fills in.
 */
export function micFixSteps(p: Platform): string[] {
  if (p.inApp) {
    return [
      "The microphone can’t be used in {app}’s in-app browser.",
      "From the menu at the top right choose “Open in Safari / Chrome” and reopen this page in a normal browser.",
    ];
  }
  if (p.os === "ios" && p.browser === "chrome") {
    return [
      "On iPhone, open Settings → Chrome → Microphone and turn it on.",
      "Go back to Chrome, reload the page, and choose “Allow” on the prompt.",
    ];
  }
  if (p.os === "ios") {
    return [
      "Tap “ぁあ” at the left of the address bar → Website Settings → Microphone → Allow.",
      "Or open Settings → Safari → Camera & Microphone Access, turn it on, and reload.",
    ];
  }
  if (p.os === "android") {
    return [
      "Tap 🔒 (or ⓘ) in the address bar → Permissions → Microphone → Allow.",
      "If that doesn’t fix it, open Settings → Apps → your browser → Permissions → Microphone, allow it, and reload.",
    ];
  }
  return [
    "Tap 🔒 in the address bar and change “Microphone” to “Allow”.",
    "Reload the page and try again.",
  ];
}
