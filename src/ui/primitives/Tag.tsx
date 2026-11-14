import type { HTMLAttributes, ReactNode } from "react";
import type { Scope } from "@/shared/contracts";
import { cx } from "./cx";
import styles from "./Tag.module.css";

const LABELS: Record<Scope, string> = { work: "회사", personal: "개인" };

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  /** work = filled ink, personal = ink outline. */
  scope: Scope;
  /** Defaults to "회사" / "개인". */
  children?: ReactNode;
}

export function Tag({ scope, children, className, ...rest }: TagProps) {
  return (
    <span className={cx(styles.tag, styles[scope], className)} {...rest}>
      {children ?? LABELS[scope]}
    </span>
  );
}
