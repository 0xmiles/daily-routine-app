"use client";

import type { InputHTMLAttributes } from "react";
import { cx } from "./cx";
import styles from "./Checkbox.module.css";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "checked" | "onChange" | "children"> {
  checked: boolean;
  /** Overdue: the box border turns --sun. */
  late?: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name (e.g. "보고서 제출 완료"). Use this or aria-labelledby. */
  label?: string;
}

/** Native checkbox (keyboard + screen reader) drawn as an ink box. Hit area is 32px. */
export function Checkbox({ checked, late = false, onChange, label, className, ...rest }: CheckboxProps) {
  return (
    <label className={cx(styles.root, late && styles.late, checked && styles.checked, className)}>
      <input
        {...rest}
        type="checkbox"
        className={styles.input}
        checked={checked}
        aria-label={label ?? rest["aria-label"]}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className={styles.box} aria-hidden="true">
        <svg viewBox="0 0 16 16" className={styles.mark} focusable="false">
          <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </label>
  );
}
