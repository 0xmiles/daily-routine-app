import { createSessionCookie } from "@/server/auth/session";
import { devLoginEnabled, getEnv } from "@/server/env";
import { problem } from "@/shared/http";
import { redirectTo } from "@/features/calendar/server/http";

// GET /api/auth/dev-login — local development only (DEV_LOGIN=1 and not
// production): signs in as the primary ALLOWED_EMAIL without Google. 404 otherwise.
export async function GET(): Promise<Response> {
  if (!devLoginEnabled()) return problem(404, "찾는 페이지가 없어요.");
  return redirectTo("/today", { cookies: [await createSessionCookie(getEnv().ALLOWED_EMAIL)] });
}
