import type { MetadataRoute } from "next";
import { THEME_COLORS } from "@/ui/theme";

// Served at /manifest.webmanifest. Icons: a fan of coloured 일력 leaves, the top one with a marker swipe and a
// check, on tangerine (public/icons; source art is src/app/icon.svg).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/today",
    name: "데일리",
    short_name: "데일리",
    description: "회사와 개인 일정, 할 일, 메모, 자산을 한곳에서 보는 하루 관리 앱이에요.",
    lang: "ko",
    dir: "ltr",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: THEME_COLORS.light.paper,
    theme_color: THEME_COLORS.light.paper,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
