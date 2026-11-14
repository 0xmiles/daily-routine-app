import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

// Loads public/sw.js into a fake ServiceWorkerGlobalScope and fires events at it.

const SOURCE = readFileSync(fileURLToPath(new URL("../../../public/sw.js", import.meta.url)), "utf8");
const ORIGIN = "https://daily.example.com";

type Listener = (event: unknown) => void;

function loadWorker(windows: Array<{ url: string }> = []) {
  const listeners: Record<string, Listener> = {};
  const clientObjects = windows.map((w) => {
    const client = {
      url: w.url,
      focus: vi.fn(async () => client),
      navigate: vi.fn(async () => client),
    };
    return client;
  });
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = fn;
    },
    skipWaiting: vi.fn(),
    registration: { showNotification: vi.fn(async () => {}) },
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: vi.fn(async () => clientObjects),
      openWindow: vi.fn(async () => null),
    },
  };
  vm.runInNewContext(SOURCE, { self, URL, console });
  async function fire(type: string, event: Record<string, unknown>) {
    let pending: Promise<unknown> = Promise.resolve();
    listeners[type]({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
  }
  return { self, fire, clientObjects };
}

const pushEvent = (payload: unknown) => ({ data: { json: () => payload, text: () => JSON.stringify(payload) } });

function clickEvent(url?: string) {
  return { notification: { close: vi.fn(), data: url ? { url } : undefined } };
}

describe("public/sw.js", () => {
  it("push shows the notification with its body, url and icon", async () => {
    const { self, fire } = loadWorker();
    await fire("push", pushEvent({ title: "보고서 제출", body: "18:00까지", url: "/today" }));
    expect(self.registration.showNotification).toHaveBeenCalledWith(
      "보고서 제출",
      expect.objectContaining({ body: "18:00까지", data: { url: "/today" }, icon: "/icons/icon-192.png" }),
    );
  });

  it("push without a usable payload still shows something safe", async () => {
    const { self, fire } = loadWorker();
    await fire("push", { data: null });
    expect(self.registration.showNotification).toHaveBeenCalledWith("데일리", expect.objectContaining({ data: { url: "/today" } }));
    await fire("push", pushEvent({ title: "x", url: "https://evil.example.com" }));
    expect(self.registration.showNotification).toHaveBeenLastCalledWith("x", expect.objectContaining({ data: { url: "/today" } }));
  });

  it("click opens a new window when the app isn't open", async () => {
    const { self, fire } = loadWorker();
    const event = clickEvent("/assets");
    await fire("notificationclick", event);
    expect(event.notification.close).toHaveBeenCalled();
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/assets`);
  });

  it("click focuses an open window on that page", async () => {
    const { self, fire, clientObjects } = loadWorker([{ url: `${ORIGIN}/assets` }]);
    await fire("notificationclick", clickEvent("/assets"));
    expect(clientObjects[0].focus).toHaveBeenCalled();
    expect(clientObjects[0].navigate).not.toHaveBeenCalled();
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it("click focuses another app window and navigates it", async () => {
    const { self, fire, clientObjects } = loadWorker([{ url: `${ORIGIN}/memo` }]);
    await fire("notificationclick", clickEvent("/today"));
    expect(clientObjects[0].focus).toHaveBeenCalled();
    expect(clientObjects[0].navigate).toHaveBeenCalledWith(`${ORIGIN}/today`);
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });
});
