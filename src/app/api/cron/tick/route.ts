import { createHash, timingSafeEqual } from "node:crypto";
import { createWebPushSender } from "@/features/notify/server/send";
import { runTick } from "@/features/notify/server/tick";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { json, problem } from "@/shared/http";

// Called every minute by an external cron with `Authorization: Bearer <CRON_SECRET>`.
// Not behind withUser: the cron has no session, only the shared secret.

export const dynamic = "force-dynamic";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Constant-time check of the bearer token (hashing first equalizes lengths). */
function authorized(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  return timingSafeEqual(digest(match[1]), digest(getEnv().CRON_SECRET));
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) return problem(401, "cron 비밀값이 맞지 않아요. Authorization 헤더를 확인해 주세요.");
  const result = await runTick(getDb(), new Date(), createWebPushSender());
  return json(result);
}

/** Vercel Cron calls GET with the same bearer header. */
export const GET = POST;
