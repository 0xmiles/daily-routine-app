// Line icons for the memo screen (stroke = currentColor). Decorative: the
// buttons that use them carry the aria-label.

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

export function SearchIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={2} {...base}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

export function CalendarIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={2} {...base}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

export function IndentIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={2} {...base}>
      <path d="M3 6h18M11 12h10M11 18h10" />
      <path d="M3 10l4 3-4 3" />
    </svg>
  );
}

export function OutdentIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={2} {...base}>
      <path d="M3 6h18M11 12h10M11 18h10" />
      <path d="M7 10l-4 3 4 3" />
    </svg>
  );
}

export function NewBlockIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={2} {...base}>
      <path d="M3 12h18" />
      <path d="M12 15v6M9 18h6" />
      <path d="M3 4h18" />
    </svg>
  );
}

export function CloseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={2} {...base}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
