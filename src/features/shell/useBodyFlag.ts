"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether `document.body.dataset[name] === "true"`, kept in sync with a
 * MutationObserver. The memo editor (Track C) sets `data-editing="true"` on
 * <body> while the keyboard is open so the shell can hide the bottom tabs.
 */
export function useBodyFlag(name: string): boolean {
  const attribute = `data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
  return useSyncExternalStore(
    (onChange) => {
      if (typeof MutationObserver === "undefined") return () => {};
      const observer = new MutationObserver(onChange);
      observer.observe(document.body, { attributes: true, attributeFilter: [attribute] });
      return () => observer.disconnect();
    },
    () => document.body.dataset[name] === "true",
    () => false,
  );
}
