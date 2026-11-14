"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { AssetsSummary, BankAccount, Txn } from "@/shared/contracts";
import { accountHue, hueStyle } from "@/ui/hues";
import { Button, cx } from "@/ui/primitives";
import { AccountPickerSheet, type AccountChoice, KIND_LABELS } from "./AccountPickerSheet";
import { AssetsApiError, createAccount, fetchSummary, fetchTxns, setTxnTransfer, uploadStatement } from "./client";
import { monthBounds, monthOfDate, seoulMonth } from "./dates";
import { flowSegments, formatMonthDay, staleNotice, summarySegments, uploadResultMessage, type Segment } from "./format";
import { Passbook } from "./Passbook";
import { UploadButton, UploadIcon, type FilePicker } from "./UploadButton";
import { ValuationSheet } from "./ValuationSheet";
import styles from "./AssetsPage.module.css";

// 자산 화면 (spec §5.4, §5.7): sentence summary, account pills, a passbook page
// per account and month, flow and stale sentences, upload by button or by
// dropping a file anywhere on the page.

const SELECTED_KEY = "assets.selectedAccount";
const LAST_UPLOAD_KEY = "assets.lastUploadAccount";
const LOAD_ERROR = "자산을 불러오지 못했어요. 잠시 뒤에 다시 불러와 주세요.";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; summary: AssetsSummary };
type Notice = { tone: "info" | "error"; text: string };

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode); the choice just is not remembered
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof AssetsApiError ? error.message : fallback;
}

function defaultMonth(account: BankAccount | undefined): string {
  const current = seoulMonth();
  if (!account?.asOf) return current;
  const month = monthOfDate(account.asOf);
  return month > current ? current : month;
}

export function Segments({ segments }: { segments: readonly Segment[] }) {
  return (
    <>
      {segments.map((segment, i) =>
        typeof segment === "string" ? (
          segment
        ) : (
          <span key={i} className="num">
            {segment.num}
          </span>
        ),
      )}
    </>
  );
}

export function AssetsPage() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Month the passbook shows, per account, once the user moves away from the default.
  const [monthOverrides, setMonthOverrides] = useState<Record<string, string>>({});
  const [txns, setTxns] = useState<Txn[] | null>(null);
  const [txnsError, setTxnsError] = useState<string | null>(null);
  const [txnsVersion, setTxnsVersion] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<{ file: File; message: string; defaultAccountId: string | null } | null>(
    null,
  );
  const [valuationTarget, setValuationTarget] = useState<BankAccount | "new" | null>(null);
  const [dragging, setDragging] = useState(false);
  const pickerRef = useRef<FilePicker>(null);

  const accounts = load.status === "ready" ? load.summary.accounts : [];
  const selected = accounts.find((a) => a.id === selectedId);
  const month = selected ? (monthOverrides[selected.id] ?? defaultMonth(selected)) : seoulMonth();

  /** Shows a fresh summary; selects `preferId` (or keeps / restores the current choice). */
  const applySummary = useCallback((summary: AssetsSummary, preferId?: string) => {
    setLoad({ status: "ready", summary });
    setSelectedId((current) => {
      const wanted = preferId ?? current ?? readStored(SELECTED_KEY);
      return (summary.accounts.find((a) => a.id === wanted) ?? summary.accounts[0])?.id ?? null;
    });
    if (preferId) {
      // Show the page the new file ends on, and reload its rows.
      setMonthOverrides((overrides) => {
        const next = { ...overrides };
        delete next[preferId];
        return next;
      });
      setTxnsVersion((v) => v + 1);
    }
  }, []);

  const refresh = useCallback(
    async (preferId?: string) => {
      try {
        applySummary(await fetchSummary(), preferId);
      } catch (error) {
        const message = messageOf(error, LOAD_ERROR);
        setLoad((prev) => (prev.status === "ready" ? prev : { status: "error", message }));
        setNotice({ tone: "error", text: message });
      }
    },
    [applySummary],
  );

  function selectAccount(account: BankAccount) {
    setSelectedId(account.id);
    writeStored(SELECTED_KEY, account.id);
  }

  useEffect(() => {
    let ignore = false;
    fetchSummary().then(
      (summary) => {
        if (!ignore) applySummary(summary);
      },
      (error: unknown) => {
        if (!ignore) setLoad({ status: "error", message: messageOf(error, LOAD_ERROR) });
      },
    );
    return () => {
      ignore = true;
    };
  }, [applySummary]);

  // Passbook rows for the selected account and month.
  useEffect(() => {
    if (!selectedId) return;
    let ignore = false;
    const { first, last } = monthBounds(month);
    fetchTxns(selectedId, { from: first, to: last })
      .then((rows) => {
        if (ignore) return;
        setTxns(rows);
        setTxnsError(null);
      })
      .catch((error: unknown) => {
        if (ignore) return;
        setTxns([]);
        setTxnsError(messageOf(error, "거래내역을 불러오지 못했어요. 잠시 뒤에 다시 열어 주세요."));
      });
    return () => {
      ignore = true;
      setTxns(null);
      setTxnsError(null);
    };
  }, [selectedId, month, txnsVersion]);

  async function upload(file: File, accountId?: string) {
    setUploading(true);
    setNotice(null);
    try {
      const result = await uploadStatement(file, accountId);
      if (result.status === "needsAccount") {
        setPending({ file, message: result.message, defaultAccountId: readStored(LAST_UPLOAD_KEY) });
        return;
      }
      if (accountId) writeStored(LAST_UPLOAD_KEY, accountId);
      setPending(null);
      setNotice({ tone: "info", text: uploadResultMessage(result.account.name, result.inserted, result.skipped) });
      await refresh(result.account.id);
    } catch (error) {
      setPending(null);
      setNotice({ tone: "error", text: messageOf(error, "거래내역을 올리지 못했어요. 잠시 뒤에 다시 해 주세요.") });
    } finally {
      setUploading(false);
    }
  }

  async function chooseAccount(choice: AccountChoice) {
    if (!pending) return;
    if ("accountId" in choice) {
      await upload(pending.file, choice.accountId);
      return;
    }
    setUploading(true);
    try {
      const account = await createAccount({ kind: choice.newKind, name: `신한 ${KIND_LABELS[choice.newKind]}` });
      await upload(pending.file, account.id);
    } catch (error) {
      setPending(null);
      setUploading(false);
      setNotice({ tone: "error", text: messageOf(error, "계좌를 만들지 못했어요. 잠시 뒤에 다시 해 주세요.") });
    }
  }

  async function toggleTransfer(txn: Txn) {
    const next = !txn.isTransfer;
    setTxns((rows) => rows?.map((r) => (r.id === txn.id ? { ...r, isTransfer: next } : r)) ?? rows);
    try {
      await setTxnTransfer(txn.id, next);
      const summary = await fetchSummary();
      setLoad({ status: "ready", summary });
    } catch (error) {
      setTxns((rows) => rows?.map((r) => (r.id === txn.id ? { ...r, isTransfer: txn.isTransfer } : r)) ?? rows);
      setNotice({ tone: "error", text: messageOf(error, "이체 표시를 바꾸지 못했어요. 잠시 뒤에 다시 해 주세요.") });
    }
  }

  // Desktop: drop a file anywhere on the page to upload it.
  const onDroppedFile = useEffectEvent((file: File) => {
    if (uploading) return;
    void upload(file);
  });
  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) onDroppedFile(file);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  const noticeLine = notice ? (
    <p className={cx(styles.notice, notice.tone === "error" && styles.noticeError)} role={notice.tone === "error" ? "alert" : "status"}>
      {notice.text}
    </p>
  ) : null;

  const sheets = (
    <>
      <AccountPickerSheet
        open={pending !== null}
        message={pending?.message ?? ""}
        accounts={accounts}
        defaultAccountId={pending?.defaultAccountId ?? null}
        busy={uploading}
        onClose={() => setPending(null)}
        onChoose={(choice) => void chooseAccount(choice)}
      />
      <ValuationSheet
        target={valuationTarget}
        onClose={() => setValuationTarget(null)}
        onSaved={(account) => {
          setValuationTarget(null);
          setNotice({ tone: "info", text: `${account.name} 금액을 저장했어요.` });
          void refresh(account.id);
        }}
      />
      {dragging ? (
        <div className={styles.dropOverlay} aria-hidden="true">
          <div className={styles.dropPanel}>
            <UploadIcon />
            <p>여기에 놓으면 거래내역을 올려요.</p>
          </div>
        </div>
      ) : null}
    </>
  );

  if (load.status !== "ready") {
    return (
      <div className={styles.page}>
        <header className={styles.head}>
          <h1 className="sr-only">자산</h1>
          {load.status === "loading" ? (
            <p className={styles.sentence}>자산을 불러오는 중이에요.</p>
          ) : (
            <>
              <p className={cx(styles.sentence, styles.noticeError)} role="alert">
                {load.message}
              </p>
              <Button variant="outline" onClick={() => void refresh()}>
                다시 불러오기
              </Button>
            </>
          )}
        </header>
      </div>
    );
  }

  const { summary } = load;

  if (summary.accounts.length === 0) {
    return (
      <div className={styles.page}>
        <header className={styles.head}>
          <h1 className="sr-only">자산</h1>
        </header>
        <section className={styles.emptyState}>
          <div className={styles.emptyPassbook} aria-hidden="true" />
          <p className={styles.sentence}>신한 인터넷뱅킹에서 받은 거래내역 엑셀을 올리면 여기에 통장처럼 보여요.</p>
          {noticeLine}
          <div className={styles.actions}>
            <UploadButton onFile={(file) => void upload(file)} busy={uploading} pickerRef={pickerRef} />
            <Button variant="ghost" onClick={() => setValuationTarget("new")}>
              투자계좌 직접 추가하기
            </Button>
          </div>
          <p className={styles.dropHint}>컴퓨터에서는 파일을 이 화면에 끌어다 놓아도 올라가요.</p>
        </section>
        {sheets}
      </div>
    );
  }

  const staleAccounts = summary.accounts.filter((a) => a.stale);

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className="sr-only">자산</h1>
        <p className={styles.sentence}>
          <Segments segments={summarySegments(summary.accounts.length, summary.total)} />
        </p>
      </header>

      <div className={styles.pills} role="group" aria-label="계좌 고르기">
        {summary.accounts.map((account, index) => (
          <button
            key={account.id}
            type="button"
            className={cx(styles.pill, account.id === selectedId && styles.pillOn)}
            style={hueStyle(accountHue(index))}
            aria-pressed={account.id === selectedId}
            onClick={() => {
              if (account.id !== selectedId) selectAccount(account);
            }}
          >
            <span className={styles.pillDot} aria-hidden="true" />
            {account.name}
          </button>
        ))}
      </div>

      {selected ? (
        <Passbook
          style={hueStyle(accountHue(summary.accounts.indexOf(selected)))}
          account={selected}
          txns={txns}
          error={txnsError}
          month={month}
          canGoNext={month < seoulMonth()}
          onMonthChange={(next) => setMonthOverrides((o) => ({ ...o, [selected.id]: next }))}
          onToggleTransfer={(txn) => void toggleTransfer(txn)}
        />
      ) : null}

      {selected && selected.kind === "investment" && !selected.stale ? (
        <p className={styles.line}>
          {selected.manualValuation && selected.asOf ? (
            <>
              <span className="num">{formatMonthDay(selected.asOf)}</span>에 직접 입력한 금액이에요.
            </>
          ) : (
            "투자계좌 거래내역에는 평가금액이 없어서, 지금 금액을 직접 입력하면 더 정확해요."
          )}{" "}
          <button type="button" className={styles.link} onClick={() => setValuationTarget(selected)}>
            지금 금액 입력하기
          </button>
        </p>
      ) : null}

      <p className={styles.line}>
        <Segments segments={flowSegments(summary.flow)} />
      </p>

      {staleAccounts.map((account) => {
        const stale = staleNotice(account);
        return (
          <p key={account.id} className={styles.line}>
            <strong className={styles.stale}>
              <Segments segments={stale.segments} />
            </strong>{" "}
            {stale.action === "valuation" ? (
              <button type="button" className={styles.link} onClick={() => setValuationTarget(account)}>
                지금 금액 입력하기
              </button>
            ) : (
              <button type="button" className={styles.link} onClick={() => pickerRef.current?.open()}>
                거래내역 엑셀 올리기
              </button>
            )}
          </p>
        );
      })}

      {noticeLine}

      <div className={styles.actions}>
        <UploadButton onFile={(file) => void upload(file)} busy={uploading} pickerRef={pickerRef} />
        <Button variant="ghost" className={styles.secondary} onClick={() => setValuationTarget("new")}>
          투자계좌 직접 추가하기
        </Button>
      </div>
      <p className={styles.dropHint}>컴퓨터에서는 파일을 이 화면에 끌어다 놓아도 올라가요.</p>

      {sheets}
    </div>
  );
}
