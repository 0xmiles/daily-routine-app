"use client";

import { useId, useState, type FormEvent } from "react";
import type { BankAccount } from "@/shared/contracts";
import { Button, Sheet } from "@/ui/primitives";
import { AssetsApiError, createAccount, setValuation } from "./client";
import { formatWon, parseWonInput } from "./format";
import styles from "./AssetsSheets.module.css";

export interface ValuationSheetProps {
  /** An investment account to update, "new" to add a 투자계좌 by hand, or null when closed. */
  target: BankAccount | "new" | null;
  onClose: () => void;
  onSaved: (account: BankAccount) => void;
}

/** 투자계좌 평가금액 entry. The entry time becomes the account's 기준 시점. */
export function ValuationSheet({ target, onClose, onSaved }: ValuationSheetProps) {
  const title = target === "new" ? "투자계좌 직접 추가하기" : target ? `${target.name} 금액 입력하기` : "";
  return (
    <Sheet open={target !== null} onClose={onClose} title={title}>
      {target !== null ? <ValuationForm target={target} onSaved={onSaved} /> : null}
    </Sheet>
  );
}

function ValuationForm({ target, onSaved }: { target: BankAccount | "new"; onSaved: (account: BankAccount) => void }) {
  const nameId = useId();
  const amountId = useId();
  const hintId = useId();
  const isNew = target === "new";
  const [name, setName] = useState("신한 투자");
  const [amountText, setAmountText] = useState(
    !isNew && target.manualValuation ? formatWon(target.manualValuation.amount) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const amount = parseWonInput(amountText);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (amount === null) {
      setError("금액을 숫자로 적어 주세요. 예를 들어 5,000,000처럼 적으면 돼요.");
      return;
    }
    if (isNew && !name.trim()) {
      setError("계좌 이름을 적어 주세요.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const account = isNew ? await createAccount({ kind: "investment", name: name.trim() }) : target;
      onSaved(await setValuation(account.id, amount));
    } catch (e) {
      setError(e instanceof AssetsApiError ? e.message : "금액을 저장하지 못했어요. 잠시 뒤에 다시 해 주세요.");
      setSaving(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {isNew ? (
        <div className={styles.field}>
          <label htmlFor={nameId} className={styles.label}>
            계좌 이름
          </label>
          <input
            id={nameId}
            className={styles.input}
            value={name}
            maxLength={40}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      ) : null}
      <div className={styles.field}>
        <label htmlFor={amountId} className={styles.label}>
          지금 평가금액
        </label>
        <div className={styles.amountRow}>
          <input
            id={amountId}
            className={`num ${styles.input} ${styles.amountInput}`}
            inputMode="numeric"
            autoComplete="off"
            placeholder="5,000,000"
            value={amountText}
            aria-describedby={hintId}
            aria-invalid={error !== null || undefined}
            onChange={(e) => setAmountText(e.target.value)}
          />
          <span className={styles.unit}>원</span>
        </div>
        <p id={hintId} className={styles.hint}>
          {amount !== null && amountText.trim() !== "" ? (
            <>
              <span className="num">{formatWon(amount)}</span>원으로 저장하고, 오늘을 기준 시점으로 보여줘요.
            </>
          ) : (
            "증권 앱에서 본 평가금액을 적어 주세요. 오늘을 기준 시점으로 보여줘요."
          )}
        </p>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" className={styles.submit} disabled={saving}>
        {saving ? "저장하는 중이에요" : isNew ? "투자계좌 추가하기" : "금액 저장하기"}
      </Button>
    </form>
  );
}
