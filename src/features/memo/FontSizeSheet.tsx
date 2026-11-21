"use client";

import { Sheet } from "@/ui/primitives";
import styles from "./MemoSheets.module.css";
import { FONT_SCALES, type FontScale } from "./viewPrefs";

const NAMES: Record<FontScale, string> = {
  0.875: "작게",
  1: "보통",
  1.125: "조금 크게",
  1.25: "크게",
  1.375: "아주 크게",
};

export interface FontSizeSheetProps {
  open: boolean;
  onClose(): void;
  /** The scale in use on this device. */
  value: FontScale;
  onChange(scale: FontScale): void;
  /** Phone or touch device: no step under 보통 (iOS would zoom in while typing). */
  compact: boolean;
}

/** 글씨 크기 of the memo text on this device. */
export function FontSizeSheet({ open, onClose, value, onChange, compact }: FontSizeSheetProps) {
  const steps = FONT_SCALES.filter((scale) => !compact || scale >= 1);
  return (
    <Sheet open={open} onClose={onClose} title="글씨 크기">
      <div role="radiogroup" aria-label="글씨 크기" className={styles.sizes}>
        {steps.map((scale) => (
          <button
            key={scale}
            type="button"
            role="radio"
            aria-checked={value === scale}
            aria-label={NAMES[scale]}
            className={styles.size}
            onClick={() => onChange(scale)}
          >
            <span className={styles.sizeSample} style={{ fontSize: `${Math.round(18 * scale)}px` }} aria-hidden="true">
              가
            </span>
            <span className={styles.sizeLabel} aria-hidden="true">
              {NAMES[scale]}
            </span>
          </button>
        ))}
      </div>
      <p className={styles.sizeNote}>메모 글씨에만 적용되고, 이 기기에서만 바뀌어요.</p>
    </Sheet>
  );
}
