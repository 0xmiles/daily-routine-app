/* 데일리 service worker: web push only (no offline caching).
 *
 * push              → show the notification sent by /api/cron/tick
 *                     (payload JSON: { title, body, url })
 * notificationclick → focus an open app window (navigating it to `url`),
 *                     or open a new one
 */

const DEFAULT_URL = "/today";
const ICON = "/icons/icon-192.png";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function readPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json() || {};
  } catch {
    return { body: event.data.text() };
  }
}

self.addEventListener("push", (event) => {
  const payload = readPayload(event);
  const title = typeof payload.title === "string" && payload.title ? payload.title : "데일리";
  const url = typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : DEFAULT_URL;
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof payload.body === "string" ? payload.body : "",
      data: { url },
      icon: ICON,
      badge: ICON,
      lang: "ko",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || DEFAULT_URL;
  const target = new URL(path, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const exact = windows.find((client) => client.url === target);
      if (exact) {
        await exact.focus();
        return;
      }
      const sameOrigin = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (sameOrigin) {
        const focused = await sameOrigin.focus();
        if ("navigate" in focused) await focused.navigate(target);
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
