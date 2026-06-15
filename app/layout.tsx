import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Realtime Translate — リアルタイム多言語翻訳",
  description:
    "OpenAI gpt-realtime-translate を使った、話した言葉をその場で多言語に翻訳する音声翻訳アプリ。",
  applicationName: "Realtime Translate",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Translate",
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
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
