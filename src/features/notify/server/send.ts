import { sendNotification, WebPushError } from "web-push";
import { getEnv, type Env } from "@/server/env";
import type { PushSender } from "./tick";

const TTL_SECONDS = 60 * 60;
const SEND_TIMEOUT_MS = 10_000;

/** Real Web Push sender (VAPID keys from the server env). 404/410 → 'gone'; other failures throw. */
export function createWebPushSender(env: Env = getEnv()): PushSender {
  const vapidDetails = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
  return async (sub, payload) => {
    try {
      await sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        // timeout: one hung push service must not stall the whole minute's tick.
        { vapidDetails, TTL: TTL_SECONDS, urgency: "high", timeout: SEND_TIMEOUT_MS },
      );
      return "ok";
    } catch (error) {
      if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) return "gone";
      throw error;
    }
  };
}
