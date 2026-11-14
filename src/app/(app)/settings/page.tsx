import type { Metadata } from "next";
import { ConnectionsSection } from "@/features/calendar/ConnectionsSection";
import { PushToggle } from "@/features/notify/PushToggle";
import { ReminderSettings } from "@/features/notify/ReminderSettings";
import { AppearanceSettings } from "@/features/shell/AppearanceSettings";
import { LogoutButton } from "@/features/shell/LogoutButton";
import { hueStyle } from "@/ui/hues";
import styles from "./settings.module.css";

export const metadata: Metadata = { title: "설정" };

/** 설정: 화면 (모드·테마) → 캘린더 연결 (개인 먼저, Track A) → 알림 → 계정. */
export default function SettingsPage() {
  return (
    <div className={styles.page}>
      <h1 className="sr-only">설정</h1>

      <section className={styles.section} style={hueStyle("tangerine")} aria-labelledby="settings-appearance">
        <h2 id="settings-appearance" className={styles.heading}>
          화면
        </h2>
        <AppearanceSettings />
      </section>

      <ConnectionsSection />

      <section className={styles.section} style={hueStyle("pink")} aria-labelledby="settings-notify">
        <h2 id="settings-notify" className={styles.heading}>
          알림
        </h2>
        <div className={styles.group}>
          <PushToggle />
        </div>
        <ReminderSettings />
      </section>

      <section className={styles.section} style={hueStyle("lilac")} aria-labelledby="settings-account">
        <h2 id="settings-account" className={styles.heading}>
          계정
        </h2>
        <div className={styles.group}>
          <p className={styles.desc}>로그아웃해도 연결한 캘린더와 적어 둔 내용은 그대로 남아요.</p>
          <div>
            <LogoutButton />
          </div>
        </div>
      </section>
    </div>
  );
}
