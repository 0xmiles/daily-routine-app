"use client";

import { useState, type FormEvent } from "react";
import type { MemoFolder } from "@/shared/contracts";
import { HUES, hueStyle, type Hue } from "@/ui/hues";
import { Button, Sheet, cx } from "@/ui/primitives";
import { CheckIcon, FolderIcon } from "./icons";
import styles from "./MemoSheets.module.css";
import { FOLDER_NAME_MAX } from "./server/limits";

// Sheets for memo folders: making one, its menu (이름 · 색 · 지우기), and the
// colour swatches shared with the 폴더와 색 sheet.

export const HUE_NAMES: Record<Hue, string> = {
  pink: "분홍",
  lilac: "라일락",
  tangerine: "귤",
  aqua: "청록",
  green: "연두",
  lemon: "레몬",
  sky: "하늘",
};

export interface HuePickerProps {
  /** Accessible name of the group. */
  label: string;
  value: Hue | null;
  onChange(hue: Hue | null): void;
  /** Adds an "automatic" choice (value null) showing `auto.hue`, e.g. 폴더 색 따르기. */
  auto?: { label: string; hue: Hue };
}

/** The seven pencils as round swatches (radio buttons). */
export function HuePicker({ label, value, onChange, auto }: HuePickerProps) {
  return (
    <div role="radiogroup" aria-label={label} className={styles.swatches}>
      {auto && (
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          className={styles.auto}
          style={hueStyle(auto.hue)}
          onClick={() => onChange(null)}
        >
          <span className={styles.autoDot} aria-hidden="true" />
          {auto.label}
        </button>
      )}
      {auto && <span className={styles.swatchBreak} aria-hidden="true" />}
      {HUES.map((hue) => (
        <button
          key={hue}
          type="button"
          role="radio"
          aria-checked={value === hue}
          aria-label={HUE_NAMES[hue]}
          title={HUE_NAMES[hue]}
          className={styles.swatch}
          style={hueStyle(hue)}
          onClick={() => onChange(hue)}
        >
          {value === hue && <CheckIcon size={18} />}
        </button>
      ))}
    </div>
  );
}

function validName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= FOLDER_NAME_MAX;
}

export interface NewFolderSheetProps {
  open: boolean;
  onClose(): void;
  /** Resolves to true once the folder exists (the sheet then closes). */
  onCreate(name: string): Promise<boolean>;
  error: string | null;
}

export function NewFolderSheet({ open, onClose, onCreate, error }: NewFolderSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="새 폴더">
      {open && <NewFolderForm onClose={onClose} onCreate={onCreate} error={error} />}
    </Sheet>
  );
}

function NewFolderForm({ onClose, onCreate, error }: Omit<NewFolderSheetProps, "open">) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validName(name) || busy) return;
    setBusy(true);
    const made = await onCreate(name.trim());
    setBusy(false);
    if (made) onClose();
  };
  return (
    <form onSubmit={submit}>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.field}>
        <input
          className={styles.input}
          aria-label="폴더 이름"
          placeholder="폴더 이름"
          value={name}
          maxLength={FOLDER_NAME_MAX}
          autoFocus
          autoComplete="off"
          enterKeyHint="done"
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" disabled={!validName(name) || busy}>
          만들기
        </Button>
      </div>
    </form>
  );
}

export interface FolderMenuSheetProps {
  folder: MemoFolder | null;
  /** How many memos are in it (for the delete question). */
  memoCount: number;
  onClose(): void;
  onRename(name: string): void;
  onRecolor(hue: Hue): void;
  onDelete(): void;
  error: string | null;
}

/** …on a folder row: rename, recolour, delete (asks first; its memos are kept). */
export function FolderMenuSheet({ folder, memoCount, onClose, onRename, onRecolor, onDelete, error }: FolderMenuSheetProps) {
  const [confirming, setConfirming] = useState(false);
  const close = () => {
    setConfirming(false);
    onClose();
  };
  const title = folder ? (confirming ? `‘${folder.name}’ 폴더를 지울까요?` : `‘${folder.name}’ 폴더`) : "";
  return (
    <Sheet open={folder !== null} onClose={close} title={title}>
      {folder &&
        (confirming ? (
          <div>
            <p className={styles.text}>
              {memoCount > 0
                ? `안에 든 메모 ${memoCount}개는 지우지 않고 폴더 밖으로 꺼내요.`
                : "안에 든 메모가 없어요. 폴더만 지워요."}
            </p>
            <div className={styles.actions}>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                그대로 두기
              </Button>
              <Button
                className={styles.danger}
                onClick={() => {
                  setConfirming(false);
                  onDelete();
                }}
              >
                폴더 지우기
              </Button>
            </div>
          </div>
        ) : (
          <FolderMenu key={folder.id} folder={folder} onRename={onRename} onRecolor={onRecolor} error={error} onAskDelete={() => setConfirming(true)} />
        ))}
    </Sheet>
  );
}

function FolderMenu({
  folder,
  onRename,
  onRecolor,
  onAskDelete,
  error,
}: {
  folder: MemoFolder;
  onRename(name: string): void;
  onRecolor(hue: Hue): void;
  onAskDelete(): void;
  error: string | null;
}) {
  const [name, setName] = useState(folder.name);
  const changed = name.trim() !== folder.name;
  const rename = (event: FormEvent) => {
    event.preventDefault();
    if (changed && validName(name)) onRename(name.trim());
  };
  return (
    <>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <form className={styles.section} onSubmit={rename}>
        <h3 className={styles.sectionTitle}>이름</h3>
        <div className={styles.field}>
          <input
            className={styles.input}
            aria-label="폴더 이름"
            value={name}
            maxLength={FOLDER_NAME_MAX}
            autoComplete="off"
            enterKeyHint="done"
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" variant="outline" disabled={!changed || !validName(name)}>
            이름 바꾸기
          </Button>
        </div>
      </form>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>색</h3>
        <HuePicker label="폴더 색" value={folder.hue} onChange={(hue) => hue && onRecolor(hue)} />
      </section>
      <div className={cx(styles.actions, styles.deleteRow)}>
        <Button variant="ghost" onClick={onAskDelete}>
          폴더 지우기
        </Button>
      </div>
    </>
  );
}

export interface FolderChoicesProps {
  folders: readonly MemoFolder[];
  value: string | null;
  onChange(folderId: string | null): void;
}

/** 폴더 없음 + every folder, as radio rows. */
export function FolderChoices({ folders, value, onChange }: FolderChoicesProps) {
  const rows: Array<{ id: string | null; name: string; hue: Hue | null }> = [
    { id: null, name: "폴더 없음", hue: null },
    ...folders.map((f) => ({ id: f.id, name: f.name, hue: f.hue })),
  ];
  return (
    <div role="radiogroup" aria-label="폴더" className={styles.options}>
      {rows.map((row) => (
        <button
          key={row.id ?? "none"}
          type="button"
          role="radio"
          aria-checked={value === row.id}
          className={styles.option}
          style={row.hue ? hueStyle(row.hue) : undefined}
          onClick={() => onChange(row.id)}
        >
          <span className={cx(styles.optionIcon, !row.hue && styles.optionNone)} aria-hidden="true">
            <FolderIcon size={14} />
          </span>
          <span className={styles.optionName}>{row.name}</span>
          {value === row.id && (
            <span className={styles.optionCheck} aria-hidden="true">
              <CheckIcon />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
