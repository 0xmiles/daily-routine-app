"use client";

import type { MemoFolder } from "@/shared/contracts";
import { hueFor } from "@/ui/hues";
import { Sheet } from "@/ui/primitives";
import type { Placement } from "./client";
import { FolderChoices, HuePicker } from "./FolderSheets";
import styles from "./MemoSheets.module.css";
import type { PadBlock } from "./store";

export interface PlacementSheetProps {
  /** The memo being placed; null closes the sheet. */
  block: PadBlock | null;
  folders: readonly MemoFolder[];
  onClose(): void;
  onPlace(patch: Placement): void;
  error: string | null;
}

/**
 * 폴더와 색: which folder the open memo is in, and its colour. Each choice
 * applies at once; the sheet stays open so both can be changed.
 */
export function PlacementSheet({ block, folders, onClose, onPlace, error }: PlacementSheetProps) {
  const folder = block?.folderId ? folders.find((f) => f.id === block.folderId) : undefined;
  return (
    <Sheet open={block !== null} onClose={onClose} title="폴더와 색">
      {block && (
        <>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>폴더</h3>
            <FolderChoices folders={folders} value={folder?.id ?? null} onChange={(folderId) => onPlace({ folderId })} />
          </section>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>색</h3>
            <HuePicker
              label="메모 색"
              value={block.hue}
              onChange={(hue) => onPlace({ hue })}
              auto={folder ? { label: "폴더 색 따르기", hue: folder.hue } : { label: "자동", hue: hueFor(block.id ?? block.key) }}
            />
          </section>
        </>
      )}
    </Sheet>
  );
}
