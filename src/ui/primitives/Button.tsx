import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";
import styles from "./Button.module.css";

export type ButtonVariant = "ink" | "outline" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** ink = filled primary (default), outline = ink border, ghost = text only. */
  variant?: ButtonVariant;
}

/** Label says what it does, e.g. "거래내역 엑셀 올리기". Defaults to type="button". */
export function Button({ variant = "ink", type = "button", className, ...rest }: ButtonProps) {
  return <button type={type} className={cx(styles.button, styles[variant], className)} {...rest} />;
}
