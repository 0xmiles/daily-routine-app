import Link from "next/link";
import { cx } from "@/ui/primitives";
import styles from "./ConnectPersonalHint.module.css";

export const CONNECT_PERSONAL_SENTENCE = "개인 캘린더를 연결하면 새 일정을 추가할 수 있어요.";

/** Quiet one-liner shown while the personal calendar isn't connected. */
export function ConnectPersonalHint({ className }: { className?: string }) {
  return (
    <p className={cx(styles.hint, className)}>
      {CONNECT_PERSONAL_SENTENCE}{" "}
      <Link href="/settings" className={styles.link}>
        설정에서 연결하기
      </Link>
    </p>
  );
}
