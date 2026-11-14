"use client";

import { useId, useState, type FormEvent } from "react";
import type { AccountKind, BankAccount } from "@/shared/contracts";
import { Button, Sheet } from "@/ui/primitives";
import styles from "./AssetsSheets.module.css";

export type AccountChoice = { accountId: string } | { newKind: AccountKind };

export interface AccountPickerSheetProps {
  open: boolean;
  /** The server's 409 message. */
  message: string;
  accounts: BankAccount[];
  /** Preselected account (the one chosen last time), if it still exists. */
  defaultAccountId: string | null;
  busy?: boolean;
  onClose: () => void;
  onChoose: (choice: AccountChoice) => void;
}

export const KIND_LABELS: Record<AccountKind, string> = {
  checking: "입출금 통장",
  savings: "적금",
  investment: "투자계좌",
};

const NEW = "__new__";

/** Shown when an uploaded file has no account number (409 needsAccount). */
export function AccountPickerSheet(props: AccountPickerSheetProps) {
  return (
    <Sheet open={props.open} onClose={props.onClose} title="계좌 고르기">
      {props.open ? <PickerForm {...props} /> : null}
    </Sheet>
  );
}

function PickerForm({ message, accounts, defaultAccountId, busy, onChoose }: AccountPickerSheetProps) {
  const name = useId();
  const kindId = useId();
  const initial =
    defaultAccountId && accounts.some((a) => a.id === defaultAccountId)
      ? defaultAccountId
      : (accounts[0]?.id ?? NEW);
  const [selected, setSelected] = useState(initial);
  const [newKind, setNewKind] = useState<AccountKind>("checking");

  function submit(event: FormEvent) {
    event.preventDefault();
    onChoose(selected === NEW ? { newKind } : { accountId: selected });
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <p className={styles.lead}>{message}</p>
      <p className={styles.hint}>파일에 계좌번호가 없어서 어느 계좌인지 알 수 없었어요.</p>
      <fieldset className={styles.choices}>
        <legend className={styles.srOnly}>거래내역을 넣을 계좌</legend>
        {accounts.map((account) => (
          <label key={account.id} className={styles.choice}>
            <input
              type="radio"
              name={name}
              value={account.id}
              checked={selected === account.id}
              onChange={() => setSelected(account.id)}
            />
            <span className={styles.choiceText}>
              {account.name}
              {account.numberMasked ? <span className={`num ${styles.choiceMeta}`}>{account.numberMasked}</span> : null}
            </span>
          </label>
        ))}
        <label className={styles.choice}>
          <input type="radio" name={name} value={NEW} checked={selected === NEW} onChange={() => setSelected(NEW)} />
          <span className={styles.choiceText}>새 계좌로 만들기</span>
        </label>
      </fieldset>
      {selected === NEW ? (
        <div className={styles.field}>
          <label htmlFor={kindId} className={styles.label}>
            계좌 종류
          </label>
          <select
            id={kindId}
            className={styles.input}
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as AccountKind)}
          >
            {(Object.keys(KIND_LABELS) as AccountKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <Button type="submit" className={styles.submit} disabled={busy}>
        {busy ? "거래내역을 올리는 중이에요" : "이 계좌로 올리기"}
      </Button>
    </form>
  );
}
