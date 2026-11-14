"use client";

import { useId, useSyncExternalStore } from "react";
import {
  APPEARANCE_EVENT,
  MODES,
  THEMES,
  THEME_GROUPS,
  applyAppearance,
  currentAppearance,
  type Mode,
  type Theme,
  type ThemeId,
} from "@/ui/appearance";
import { HUES, hueStyle } from "@/ui/hues";
import { cx } from "@/ui/primitives";
import styles from "./AppearanceSettings.module.css";

const SERVER_SNAPSHOT = "crayon|system|light";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(APPEARANCE_EVENT, onChange);
  // data-scheme also changes when the OS flips light/dark under 시스템.
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scheme"] });
  return () => {
    window.removeEventListener(APPEARANCE_EVENT, onChange);
    observer.disconnect();
  };
}

function snapshot(): string {
  const { theme, mode } = currentAppearance();
  const scheme = document.documentElement.getAttribute("data-scheme") === "dark" ? "dark" : "light";
  return `${theme}|${mode}|${scheme}`;
}

/** 설정 › 화면: light / dark / 시스템, and the colour theme. Saved on this device. */
export function AppearanceSettings() {
  const [theme, mode, scheme] = useSyncExternalStore(subscribe, snapshot, () => SERVER_SNAPSHOT).split("|") as [
    ThemeId,
    Mode,
    "light" | "dark",
  ];
  const modeName = useId();
  const themeName = useId();
  const modeLabel = useId();
  const themeLabel = useId();

  return (
    <div className={styles.root}>
      <div className={styles.block}>
        <p id={modeLabel} className={styles.label}>
          모드
        </p>
        <div role="radiogroup" aria-labelledby={modeLabel} className={styles.modes}>
          {MODES.map((m) => (
            <label key={m.id} className={cx(styles.mode, m.id === mode && styles.modeOn)}>
              <input
                type="radio"
                className={styles.radio}
                name={modeName}
                value={m.id}
                checked={m.id === mode}
                onChange={() => applyAppearance(theme, m.id)}
              />
              {m.name}
            </label>
          ))}
        </div>
        <p className={styles.desc}>시스템을 고르면 기기 설정을 따라 밝은 화면과 어두운 화면이 바뀌어요.</p>
      </div>

      <div className={styles.block}>
        <p id={themeLabel} className={styles.label}>
          테마
        </p>
        {/* One radiogroup (one radio name) split into 기본 and 개발자, so arrow keys run through all of them. */}
        <div role="radiogroup" aria-labelledby={themeLabel} className={styles.groups}>
          {THEME_GROUPS.map((group) => (
            <div key={group.id} role="group" className={styles.group} aria-labelledby={`${themeLabel}-${group.id}`}>
              <p className={styles.groupHead}>
                <span id={`${themeLabel}-${group.id}`} className={styles.groupName}>
                  {group.name}
                </span>
                <span className={styles.groupNote}>{group.note}</span>
              </p>
              <div className={cx(styles.themes, group.id === "dev" && styles.devThemes)}>
                {THEMES.filter((t) => t.group === group.id).map((t) => (
                  <ThemeCard
                    key={t.id}
                    theme={t}
                    on={t.id === theme}
                    scheme={scheme}
                    name={themeName}
                    onPick={() => applyAppearance(t.id, mode)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className={styles.desc}>테마와 모드는 이 기기에만 저장돼요.</p>
      </div>
    </div>
  );
}

function ThemeCard({
  theme: t,
  on,
  scheme,
  name,
  onPick,
}: {
  theme: Theme;
  on: boolean;
  scheme: "light" | "dark";
  name: string;
  onPick: () => void;
}) {
  return (
    // Each card renders in its own theme (themes.css selectors are attribute-only).
    <label className={cx(styles.card, on && styles.cardOn)} data-theme={t.id} data-scheme={scheme}>
      <input type="radio" className={styles.radio} name={name} value={t.id} checked={on} onChange={onPick} />
      <span className={styles.pencils} aria-hidden="true">
        {HUES.map((hue) => (
          <i key={hue} className={styles.pencil} style={hueStyle(hue)} />
        ))}
      </span>
      <span className={styles.name}>
        {t.name}
        {on && <CheckIcon />}
      </span>
      {t.note ? (
        <span className={styles.note}>{t.note}</span>
      ) : (
        // 개발자 themes show a line of code in the theme's own text colours instead of a note.
        <code className={styles.code} aria-hidden="true">
          <span className={styles.kw}>let</span> 오늘 <span className={styles.op}>=</span>{" "}
          <span className={styles.str}>&quot;할 일&quot;</span>
          <span className={styles.op}>;</span>
        </code>
      )}
    </label>
  );
}

function CheckIcon() {
  return (
    <svg className={styles.check} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
