import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { PushToggle } from "./PushToggle";

const VAPID = "BA2sgyhPqP17WD0086yydYya2ClzFQQ1KK_OchtSR_AkOfGXzH0dhbViPu7LpgiySUxdlvnVKrCNwXTgPzJ361w";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}

function setStandalone(standalone: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("standalone") ? standalone : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function fakeSubscription(endpoint = "https://push.example.com/me") {
  return {
    endpoint,
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "k", auth: "a" } }),
    unsubscribe: vi.fn(async () => true),
  };
}

/** Installs serviceWorker / PushManager / Notification fakes. */
function installPush(opts: { existing?: ReturnType<typeof fakeSubscription> | null; permission?: NotificationPermission } = {}) {
  let current = opts.existing ?? null;
  const created = fakeSubscription();
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => {
      current = created;
      return created;
    }),
  };
  const registration = { pushManager };
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: {
      register: vi.fn(async () => registration),
      getRegistration: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
    },
  });
  (window as unknown as { PushManager: unknown }).PushManager = function PushManager() {};
  const Notification = {
    permission: opts.permission ?? "default",
    requestPermission: vi.fn(async () => {
      Notification.permission = "granted";
      return "granted" as NotificationPermission;
    }),
  };
  (window as unknown as { Notification: unknown }).Notification = Notification;
  return { pushManager, created, Notification };
}

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", VAPID);
  setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15");
  setStandalone(false);
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  fetchSpy.mockRestore();
  delete (window.navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  delete (window as unknown as { PushManager?: unknown }).PushManager;
  delete (window as unknown as { Notification?: unknown }).Notification;
});

describe("PushToggle", () => {
  it("iPhone Safari outside the home screen app explains how to enable", async () => {
    setUserAgent(IPHONE_UA);
    installPush();
    render(<PushToggle />);
    expect(await screen.findByText("홈 화면에 추가한 뒤 알림을 켤 수 있어요.")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("iPhone home screen app can turn notifications on", async () => {
    setUserAgent(IPHONE_UA);
    setStandalone(true);
    installPush();
    render(<PushToggle />);
    expect(await screen.findByRole("switch", { name: "알림 받기" })).toBeTruthy();
  });

  it("says when the browser has no web push", async () => {
    render(<PushToggle />);
    expect(await screen.findByText(/이 브라우저는 웹 알림을 지원하지 않아요/)).toBeTruthy();
  });

  it("turning on asks permission, subscribes with the VAPID key and registers with the server", async () => {
    const { pushManager, Notification } = installPush();
    render(<PushToggle />);
    const toggle = await screen.findByRole("switch", { name: "알림 받기" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    await userEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
    expect(Notification.requestPermission).toHaveBeenCalled();
    const options = pushManager.subscribe.mock.calls[0] as unknown as [PushSubscriptionOptionsInit];
    expect(options[0].userVisibleOnly).toBe(true);
    expect((options[0].applicationServerKey as Uint8Array).length).toBe(65);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/push/subscribe");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      endpoint: "https://push.example.com/me",
      expirationTime: null,
      keys: { p256dh: "k", auth: "a" },
    });
  });

  it("turning off unsubscribes and tells the server", async () => {
    const existing = fakeSubscription("https://push.example.com/old");
    installPush({ existing, permission: "granted" });
    render(<PushToggle />);
    const toggle = await screen.findByRole("switch", { name: "알림 받기" });
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));

    await userEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
    expect(existing.unsubscribe).toHaveBeenCalled();
    const del = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit)?.method === "DELETE");
    expect(JSON.parse(String((del?.[1] as RequestInit).body))).toEqual({ endpoint: "https://push.example.com/old" });
  });

  it("blocked permission tells how to fix it", async () => {
    installPush({ permission: "denied" });
    render(<PushToggle />);
    expect(await screen.findByText(/알림이 차단되어 있어요/)).toBeTruthy();
  });
});
