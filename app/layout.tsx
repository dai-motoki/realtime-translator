import type { Metadata, Viewport } from "next";
import { SITE_LOG_BEACON_JS } from "@/lib/siteLogBeacon";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "AI Realtime Translate — real-time multilingual translation",
  description:
    "A voice translation app powered by OpenAI gpt-realtime-translate that turns what you say into other languages on the spot.",
  applicationName: "AI Realtime Translate",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AI Realtime Translate",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0f",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <I18nProvider>{children}</I18nProvider>
        {/* 匿名アクセスログのビーコン（zentou-ops の /admin/site-log に集約） */}
        <script dangerouslySetInnerHTML={{ __html: SITE_LOG_BEACON_JS }} />
      </body>
    </html>
  );
}
