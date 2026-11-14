"use client";

import { useSyncExternalStore } from "react";

// A shared clock that ticks every 30 seconds. `null` during server render and
// hydration, so time-dependent markup (the now line) never mismatches.

const TICK_MS = 30_000;
let current: Date | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === undefined) {
    current = new Date();
    timer = setInterval(() => {
      current = new Date();
      for (const l of listeners) l();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function getSnapshot(): Date {
  current ??= new Date();
  return current;
}

export function useNow(): Date | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
