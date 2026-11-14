import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { devLoginEnabled } from "@/server/env";
import { Button } from "@/ui/primitives";
import styles from "./login.module.css";

export const metadata: Metadata = { title: "로그인" };

// Set by /api/auth/callback/google when sign-in could not finish.
const ERROR_MESSAGES: Record<string, string> = {
  state: "로그인 확인 시간이 지났어요. 아래 버튼을 눌러 다시 로그인해 주세요.",
  google: "Google에서 로그인 정보를 받지 못했어요. 잠시 뒤 다시 로그인해 주세요.",
};

export default async function LoginPage(props: PageProps<"/login">) {
  const { error } = await props.searchParams;
  const signedIn = await requireUser().then(
    () => true,
    () => false,
  );
  if (signedIn) redirect("/today");

  const message = typeof error === "string" ? ERROR_MESSAGES[error] : undefined;
  const showDevLogin = devLoginEnabled();

  return (
    <main className={styles.page}>
      <div className={styles.leaf}>
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static brand mark */}
        <img src="/icons/mark.svg" alt="" className={styles.mark} width={64} height={64} />
        <h1 className={styles.name}>데일리</h1>
        <p className={styles.lede}>회사와 개인 일정, 할 일, 메모, 자산을 한곳에서 봐요.</p>
        <hr className={styles.perforation} />
        <p className={styles.prompt}>허용된 Google 계정으로 로그인해 주세요.</p>
        {message ? (
          <p className={styles.error} role="alert">
            {message}
          </p>
        ) : null}
        <form action="/api/auth/login" method="get">
          <Button type="submit" className={styles.google}>
            Google로 로그인
          </Button>
        </form>
        {showDevLogin ? (
          <a className={styles.dev} href="/api/auth/dev-login">
            개발용 로그인
          </a>
        ) : null}
      </div>
    </main>
  );
}
