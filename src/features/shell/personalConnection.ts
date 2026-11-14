"use client";

import { useEffect, useSyncExternalStore } from "react";
import { fetchEvents } from "@/features/calendar/client";
import { seoulToday } from "@/shared/time";

// Whether the personal Google calendar is connected (EventsResponse.personalConnected).
// Logging in uses the work account, so "not connected" is a normal first-run
// state: work and holiday events still show, but new events can't be created.
//
// Screens that fetch events report the flag here; quick add and the event
// editor read it. If nobody has fetched yet, the hook asks once for today.

let known: boolean | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setPersonalConnected(value: boolean): void {
  if (known === value) return;
  known = value;
  emit();
}

function load(): void {
  if (known !== null || pending) return;
  const today = seoulToday();
  pending = fetchEvents(today, today)
    .then((res) => setPersonalConnected(res.personalConnected))
    .catch(() => {
      // Unknown: let the form show; the server still rejects writes it can't do.
    })
    .finally(() => {
      pending = null;
    });
}

/** `null` while unknown. Pass `enabled=false` to avoid fetching. */
export function usePersonalConnected(enabled = true): boolean | null {
  const value = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => known,
    () => null,
  );
  useEffect(() => {
    if (enabled) load();
  }, [enabled]);
  return value;
}

/** Test-only. */
export function resetPersonalConnectedForTests(): void {
  known = null;
  pending = null;
  emit();
}
