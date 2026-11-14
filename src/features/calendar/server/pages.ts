import { THEME_COLORS } from "@/ui/theme";

// Standalone HTML pages returned straight from the login callback (403s), where
// the app's CSS is not loaded. Colors come from THEME_COLORS (the mirror of
// --paper / --ink in tokens.css for places that cannot read CSS variables).

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

interface PageInput {
  status: number;
  heading: string;
  body: string;
  action: { href: string; label: string };
  cookies?: string[];
}

function htmlPage({ status, heading, body, action, cookies = [] }: PageInput): Response {
  const { light, dark } = THEME_COLORS;
  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(heading)}</title>
<style>
  :root { color-scheme: light dark; --paper: ${light.paper}; --ink: ${light.ink}; }
  @media (prefers-color-scheme: dark) { :root { --paper: ${dark.paper}; --ink: ${dark.ink}; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 24px 20px;
    background: var(--paper); color: var(--ink);
    font-family: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif;
    line-height: 1.6; letter-spacing: -0.01em; }
  main { width: min(420px, 100%); }
  h1 { margin: 0 0 10px; font-size: 21px; line-height: 1.4; font-weight: 700; }
  p { margin: 0 0 24px; font-size: 15px; opacity: 0.78; overflow-wrap: anywhere; }
  a { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 10px 18px;
    border-radius: 8px; background: var(--ink); color: var(--paper); font-size: 15px; font-weight: 600;
    text-decoration: none; }
  a:hover { opacity: 0.88; }
  a:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(heading)}</h1>
  <p>${escapeHtml(body)}</p>
  <a href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>
</main>
</body>
</html>`;
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(html, { status, headers });
}

/** 403: signed in to Google with an email that is not in ALLOWED_EMAIL. */
export function notAllowedPage(email: string, cookies?: string[]): Response {
  return htmlPage({
    status: 403,
    heading: "허용되지 않은 계정이에요.",
    body: `${email} 계정으로는 이 앱에 들어올 수 없어요. 허용된 Google 계정으로 다시 로그인해 주세요.`,
    action: { href: "/api/auth/login", label: "다른 계정으로 로그인하기" },
    cookies,
  });
}

/** 403: the account's organization (or a cancelled consent) stopped the sign-in. */
export function loginBlockedPage(cookies?: string[]): Response {
  return htmlPage({
    status: 403,
    heading: "이 계정으로는 로그인할 수 없게 막혀 있어요.",
    body: "다른 허용된 Google 계정으로 로그인해 주세요.",
    action: { href: "/api/auth/login", label: "다른 계정으로 로그인하기" },
    cookies,
  });
}
