import type { PushSubscriptionBody, ReminderSettings, ReminderSettingsPatch } from "./types";

// Browser-side calls for push subscriptions and reminder settings. Failures
// throw NotifyApiError whose message is the server's `{ message }`.

export class NotifyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "NotifyApiError";
  }
}

const NETWORK_MESSAGE = "서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.";

async function request<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      headers: init.body ? { "content-type": "application/json" } : undefined,
    });
  } catch {
    throw new NotifyApiError(NETWORK_MESSAGE, 0);
  }
  if (!res.ok) {
    let message = fallback;
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body.message === "string" && body.message) message = body.message;
    } catch {
      // keep the fallback
    }
    throw new NotifyApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function subscribePush(subscription: PushSubscriptionBody): Promise<void> {
  await request("/api/push/subscribe", { method: "POST", body: JSON.stringify(subscription) }, "알림을 켜지 못했어요. 잠시 뒤 다시 시도해 주세요.");
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  await request("/api/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint }) }, "알림을 끄지 못했어요. 잠시 뒤 다시 시도해 주세요.");
}

export function fetchReminderSettings(): Promise<ReminderSettings> {
  return request("/api/settings/reminders", { method: "GET" }, "알림 설정을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.");
}

export function saveReminderSettings(patch: ReminderSettingsPatch): Promise<ReminderSettings> {
  return request(
    "/api/settings/reminders",
    { method: "PUT", body: JSON.stringify(patch) },
    "알림 설정을 저장하지 못했어요. 인터넷 연결을 확인하고 다시 골라 주세요.",
  );
}

/** VAPID public key (base64url) → bytes for `pushManager.subscribe`. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
