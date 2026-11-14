"use client";

import { useId } from "react";
import type { BankAccount, Txn } from "@/shared/contracts";
import { cx } from "@/ui/primitives";
import { shiftMonth } from "./dates";
import { formatMonthDay, formatWon, passbookDate } from "./format";
import styles from "./Passbook.module.css";

export interface PassbookProps {
  account: BankAccount;
  /** null while loading. */
  txns: Txn[] | null;
  /** 'YYYY-MM' shown on this page of the passbook. */
  month: string;
  canGoNext: boolean;
  onMonthChange: (month: string) => void;
  /** Row tap: flip whether this is a transfer between own accounts. */
  onToggleTransfer: (txn: Txn) => void;
  /** Shown instead of the rows when loading failed. */
  error?: string | null;
}

/**
 * One page of a bank passbook (통장): 날짜 / 내용 / 찾으신 금액 / 맡기신 금액 /
 * 잔액 on the --passbook surface with faint ruled lines. Transfers between own
 * accounts are muted and marked "이체"; tapping a row toggles that.
 */
export function Passbook({ account, txns, month, canGoNext, onMonthChange, onToggleTransfer, error }: PassbookProps) {
  const hintId = useId();
  const [year, monthNumber] = [month.slice(0, 4), Number(month.slice(5, 7))];
  const lastId = txns && txns.length > 0 ? txns[txns.length - 1].id : null;

  return (
    <section className={styles.passbook} aria-label={`${account.name} 통장`}>
      <div className={styles.title}>
        <span className={styles.name}>
          {account.name}
          {account.numberMasked ? <span className={cx("num", styles.number)}>{account.numberMasked}</span> : null}
        </span>
        <span className={styles.asOf}>
          {account.asOf ? (
            <>
              <DateText date={account.asOf} /> 기준{" "}
            </>
          ) : null}
          {account.balance !== null ? (
            <>
              <span className={cx("num", styles.balanceTotal)}>{formatWon(account.balance)}</span>원
            </>
          ) : null}
        </span>
      </div>

      <div className={styles.monthNav}>
        <button
          type="button"
          className={styles.monthButton}
          aria-label="이전 달 보기"
          onClick={() => onMonthChange(shiftMonth(month, -1))}
        >
          <Chevron direction="left" />
        </button>
        <span className={styles.monthLabel} aria-live="polite">
          <span className="num">{year}</span>년 <span className="num">{monthNumber}</span>월
        </span>
        <button
          type="button"
          className={styles.monthButton}
          aria-label="다음 달 보기"
          disabled={!canGoNext}
          onClick={() => onMonthChange(shiftMonth(month, 1))}
        >
          <Chevron direction="right" />
        </button>
      </div>

      <table className={styles.table}>
        <caption className={styles.srOnly}>
          {monthNumber}월 거래내역이에요. 거래를 누르면 내 계좌끼리 옮긴 돈인지 바꿀 수 있어요.
        </caption>
        <colgroup>
          <col className={styles.colDate} />
          <col />
          <col className={styles.colAmount} />
          <col className={styles.colAmount} />
          <col className={styles.colBalance} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className={styles.left}>
              날짜
            </th>
            <th scope="col" className={styles.left}>
              내용
            </th>
            <th scope="col">찾으신 금액</th>
            <th scope="col">맡기신 금액</th>
            <th scope="col">잔액</th>
          </tr>
        </thead>
        <tbody>
          {(txns ?? []).map((txn) => (
            <tr
              key={txn.id}
              className={cx(styles.row, txn.isTransfer && styles.transfer)}
              onClick={() => onToggleTransfer(txn)}
            >
              <td className={cx("num", styles.date)}>{passbookDate(txn.occurredAt)}</td>
              <td className={styles.desc}>
                <button
                  type="button"
                  className={styles.descButton}
                  aria-pressed={txn.isTransfer}
                  aria-describedby={hintId}
                >
                  <span className={styles.descText}>{txn.description || "내용 없음"}</span>
                  {txn.isTransfer ? <span className={styles.badge}>이체</span> : null}
                </button>
              </td>
              <td className={cx("num", styles.amount)}>{txn.withdrawal ? formatWon(txn.withdrawal) : ""}</td>
              <td className={cx("num", styles.amount)}>{txn.deposit ? formatWon(txn.deposit) : ""}</td>
              <td className={cx("num", styles.amount, txn.id === lastId && styles.latest)}>
                {formatWon(txn.balanceAfter)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <span id={hintId} className={styles.srOnly}>
        누르면 내 계좌끼리 옮긴 돈(이체)으로 표시하거나 표시를 빼요.
      </span>

      {error ? (
        <p className={styles.empty} role="alert">
          {error}
        </p>
      ) : txns === null ? (
        <p className={styles.empty}>거래내역을 불러오는 중이에요.</p>
      ) : txns.length === 0 ? (
        <p className={styles.empty}>
          {account.kind === "investment" && account.manualValuation
            ? `${monthNumber}월에는 거래가 없어요. 이 계좌는 직접 입력한 금액으로 보여줘요.`
            : `${monthNumber}월에는 거래가 없어요.`}
        </p>
      ) : null}
    </section>
  );
}

function DateText({ date }: { date: string }) {
  const [m, d] = formatMonthDay(date).split(" ");
  return (
    <>
      <span className="num">{m.replace("월", "")}</span>월 <span className="num">{d.replace("일", "")}</span>일
    </>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}
