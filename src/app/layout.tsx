import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Sans_KR } from "next/font/google";
import { THEME_COLORS } from "@/ui/theme";
import "@/ui/tokens.css";
import "./globals.css";

// Archivo: dates and all numbers (variable width axis for the narrow 62% numerals).
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-num",
  display: "swap",
});

// IBM Plex Sans KR: Korean body text.
const plexSansKr = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "일력",
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
    <html lang="ko" className={`${archivo.variable} ${plexSansKr.variable}`}>
      <body>{children}</body>
    </html>
  );
}
