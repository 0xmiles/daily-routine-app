"use client";

import { useImperativeHandle, useRef, type ReactNode, type Ref } from "react";
import { Button, cx } from "@/ui/primitives";
import styles from "./AssetsPage.module.css";

/** File types the 신한 인터넷뱅킹 거래내역 download comes in (HTML-as-.xls included). */
export const UPLOAD_ACCEPT = ".xls,.xlsx,.csv,.html";

export interface FilePicker {
  /** Opens the system file chooser. */
  open(): void;
}

export interface UploadButtonProps {
  onFile: (file: File) => void;
  busy?: boolean;
  /** Lets other controls (e.g. a stale-balance link) open the same chooser. */
  pickerRef?: Ref<FilePicker>;
  className?: string;
  children?: ReactNode;
}

/** Outline button "거래내역 엑셀 올리기" with its own hidden file input. */
export function UploadButton({ onFile, busy = false, pickerRef, className, children }: UploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(pickerRef, () => ({ open: () => inputRef.current?.click() }), []);

  return (
    <>
      <Button
        variant="outline"
        className={cx(styles.uploadButton, className)}
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => inputRef.current?.click()}
      >
        <UploadIcon />
        {busy ? "거래내역을 올리는 중이에요" : (children ?? "거래내역 엑셀 올리기")}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className={styles.fileInput}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
    </>
  );
}

export function UploadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
    </svg>
  );
}
