import type { Metadata, Viewport } from "next";
import { Archivo, Hahmlet } from "next/font/google";
import { THEME_COLORS } from "@/ui/theme";
// Pretendard: Korean body text. Dynamic subsets, so a page only downloads the slices it uses.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "@/ui/tokens.css";
import "./globals.css";

// Archivo: dates and all numbers (variable width axis for the narrow 62% numerals).
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-num",
  display: "swap",
});

// Hahmlet: headings (variable weight). Korean slices load on demand.
const hahmlet = Hahmlet({
  subsets: ["latin"],
  variable: "--font-head",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "데일리", template: "%s · 데일리" },
  description: "회사와 개인 일정, 할 일, 메모, 자산을 한곳에서 보는 하루 관리 앱이에요.",
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
    <html lang="ko" className={`${archivo.variable} ${hahmlet.variable}`}>
      <body>{children}</body>
    </html>
  );
}
