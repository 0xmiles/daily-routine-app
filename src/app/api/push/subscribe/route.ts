import { eq } from "drizzle-orm";
import { z } from "zod";
import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { pushSubscriptions } from "@/server/db/schema";
import { json, problem } from "@/shared/http";

const BAD_SUBSCRIPTION = "알림 구독 정보가 올바르지 않아요. 설정에서 알림을 껐다가 다시 켜 주세요.";

// Browser push services (Chrome/Edge FCM, Safari/iOS, Firefox, legacy Edge WNS).
// The cron POSTs to stored endpoints, so anything else is refused (no SSRF).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

function isKnownPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.port === "" && PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

const endpointSchema = z
  .url()
  .max(2048)
  .refine(isKnownPushEndpoint, { message: "push endpoints must be a known browser push service" });

const subscribeSchema = z.object({
  endpoint: endpointSchema,
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }),
});

const unsubscribeSchema = z.object({ endpoint: endpointSchema });

async function body(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** Saves this browser's push subscription (upsert by endpoint). */
export const POST = withUser(async (req) => {
  const parsed = subscribeSchema.safeParse(await body(req));
  if (!parsed.success) return problem(400, BAD_SUBSCRIPTION);
  const { endpoint, keys } = parsed.data;
  await getDb()
    .insert(pushSubscriptions)
    .values({ endpoint, p256dh: keys.p256dh, auth: keys.auth })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { p256dh: keys.p256dh, auth: keys.auth } });
  return json({ ok: true }, 201);
});

/** Forgets this browser's subscription (notifications turned off). */
export const DELETE = withUser(async (req) => {
  const parsed = unsubscribeSchema.safeParse(await body(req));
  if (!parsed.success) return problem(400, BAD_SUBSCRIPTION);
  await getDb().delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, parsed.data.endpoint));
  return new Response(null, { status: 204 });
});
