import type { Metadata, Viewport } from "next";
import { THEME_BOOT_SCRIPT } from "@/ui/appearance";
import { AppearanceSync } from "@/ui/AppearanceSync";
import { THEME_COLORS } from "@/ui/theme";
// Pretendard: the one font for headings, body and numbers. Dynamic subsets, so a
// page only downloads the Korean slices it uses.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "@/ui/tokens.css";
import "@/ui/themes.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "데일리", template: "%s · 데일리" },
  description: "회사와 개인 일정, 할 일, 메모를 한곳에서 보는 하루 관리 앱이에요.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light.paper },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark.paper },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The boot script sets data-theme / data-mode / data-scheme before the first
    // paint (설정 › 화면), so <html> differs from the server render on purpose.
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <AppearanceSync />
        {children}
      </body>
    </html>
  );
}
