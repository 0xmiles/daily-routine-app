"use client";

import { useEffect, useId, useState } from "react";
import { cx } from "@/ui/primitives";
import { subscribePush, unsubscribePush, urlBase64ToUint8Array } from "./client";
import type { PushSubscriptionBody } from "./types";
import styles from "./PushToggle.module.css";

type Status = "checking" | "unsupported" | "ios-browser" | "no-key" | "denied" | "off" | "on";

const SW_URL = "/sw.js";

/** The only value the browser gets from the env; inlined by Next at build time. */
function vapidPublicKey(): string {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch points give it away.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  const displayMode = typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
  return displayMode || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** What can be decided without async calls. */
function detect(): Status {
  if (isIos() && !isStandalone()) return "ios-browser";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (!vapidPublicKey()) return "no-key";
  if (Notification.permission === "denied") return "denied";
  return "checking";
}

function toBody(subscription: PushSubscription): PushSubscriptionBody {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
  };
}

const DESCRIPTIONS: Record<Status, string> = {
  checking: "알림 상태를 확인하고 있어요.",
  on: "할 일 마감 알림이 이 기기로 와요.",
  off: "켜면 할 일 마감 알림을 이 기기로 보내 드려요.",
  "ios-browser": "홈 화면에 추가한 뒤 알림을 켤 수 있어요.",
  unsupported: "이 브라우저는 웹 알림을 지원하지 않아요. 맥에서는 Safari나 Chrome으로 열어 주세요.",
  denied: "알림이 차단되어 있어요. 브라우저 설정에서 이 사이트의 알림을 허용한 뒤 다시 열어 주세요.",
  "no-key": "알림 키가 설정되지 않았어요. 서버 환경 변수 NEXT_PUBLIC_VAPID_PUBLIC_KEY를 확인해 주세요.",
};

/** 알림 받기 switch: asks permission, subscribes this device and registers it with the server. */
export function PushToggle() {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();
  const descId = useId();

  useEffect(() => {
    let alive = true;
    (async () => {
      const initial = detect();
      if (initial !== "checking") {
        if (alive) setStatus(initial);
        return;
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (!alive) return;
        if (subscription && Notification.permission === "granted") {
          setStatus("on");
          // The server may have dropped it (e.g. after a 410); keep it registered.
          subscribePush(toBody(subscription)).catch(() => {});
        } else {
          setStatus("off");
        }
      } catch {
        if (alive) setStatus("off");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function turnOn() {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus(permission === "denied" ? "denied" : "off");
      if (permission !== "denied") setError("알림을 허용해야 켤 수 있어요. 다시 눌러 허용을 골라 주세요.");
      return;
    }
    const registration = await navigator.serviceWorker.register(SW_URL);
    await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey()),
      }));
    await subscribePush(toBody(subscription));
    setStatus("on");
  }

  async function turnOff() {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await unsubscribePush(subscription.endpoint).catch(() => {});
      await subscription.unsubscribe();
    }
    setStatus("off");
  }

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (status === "on") await turnOff();
      else await turnOn();
    } catch (err) {
      setError(
        err instanceof Error && "status" in err && err.message
          ? err.message
          : status === "on"
            ? "알림을 끄지 못했어요. 잠시 뒤 다시 눌러 주세요."
            : "알림을 켜지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }

  const switchable = status === "on" || status === "off";

  return (
    <div className={styles.root}>
      <div className={styles.row}>
        <div className={styles.text}>
          <p id={labelId} className={styles.label}>
            알림 받기
          </p>
          <p id={descId} className={cx(styles.desc, status === "denied" && styles.warn)}>
            {DESCRIPTIONS[status]}
          </p>
          {status === "ios-browser" && (
            <p className={styles.desc}>Safari 공유 버튼에서 홈 화면에 추가를 누르고, 홈 화면의 데일리로 열어 주세요.</p>
          )}
        </div>
        {switchable && (
          <button
            type="button"
            role="switch"
            aria-checked={status === "on"}
            aria-labelledby={labelId}
            aria-describedby={descId}
            className={cx(styles.switch, status === "on" && styles.on)}
            disabled={busy}
            onClick={() => void toggle()}
          >
            <span className={styles.knob} aria-hidden="true" />
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
