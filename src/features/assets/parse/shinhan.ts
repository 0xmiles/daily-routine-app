import * as XLSX from "xlsx";
import type { AccountKind } from "@/shared/contracts";

// Reads a 신한 인터넷뱅킹 거래내역 file: .xlsx, .xls (BIFF or an HTML table
// saved as .xls), or .csv. The header row is found by column names in the first
// 30 rows; title cells above it give the account number, 조회기간 and a hint of
// the account kind. Runs on the server; the original file is never stored.

export interface ParsedRow {
  /** ISO with +09:00, second precision. */
  occurredAt: string;
  description: string;
  withdrawal: number;
  deposit: number;
  balanceAfter: number;
}

export interface ParsedStatement {
  /** Digits of the account number, when the file shows it unmasked. */
  accountDigits: string | null;
  numberMasked: string | null;
  kindHint: AccountKind | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** Oldest first (newest-first files are reversed). */
  rows: ParsedRow[];
}

/** `error` is shown to the user as-is. */
export interface ParseError {
  error: string;
}

export const HEADER_NOT_FOUND_MESSAGE =
  "거래내역 표를 찾지 못했어요. 신한 인터넷뱅킹에서 받은 거래내역 엑셀인지 확인해 주세요.";
export const UNREADABLE_FILE_MESSAGE =
  "파일을 열지 못했어요. 암호가 걸린 파일이면 암호를 풀고 저장한 뒤 다시 올려 주세요.";
const FIX_HINT = "신한 인터넷뱅킹에서 받은 파일을 고치지 않고 그대로 올려 주세요.";

const HEADER_SEARCH_ROWS = 30;

type Field = "date" | "time" | "description" | "withdrawal" | "deposit" | "balance";

// Normalized header names (spaces and parenthesized units removed).
// Description columns are listed by priority: 내용 (상대방, 메모) reads better
// in a passbook than 적요 (거래 종류), which is the fallback when 내용 is blank.
const SYNONYMS: Record<Field, readonly string[]> = {
  date: ["거래일자", "거래일시", "일자"],
  time: ["거래시간"],
  description: ["내용", "기재내용", "거래내용", "적요"],
  withdrawal: ["출금", "출금액", "찾으신금액"],
  deposit: ["입금", "입금액", "맡기신금액"],
  balance: ["잔액", "거래후잔액"],
};

type Cell = string | number | boolean | Date | null | undefined;

interface Columns {
  date: number;
  time: number | null;
  descriptions: number[];
  withdrawal: number | null;
  deposit: number | null;
  balance: number;
}

export function isParseError(result: ParsedStatement | ParseError): result is ParseError {
  return "error" in result;
}

export function parseShinhanWorkbook(buf: ArrayBuffer): ParsedStatement | ParseError {
  let wb: XLSX.WorkBook;
  try {
    wb = readWorkbook(new Uint8Array(buf));
  } catch {
    return { error: UNREADABLE_FILE_MESSAGE };
  }
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904);

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws["!ref"]) continue;
    const firstRow = XLSX.utils.decode_range(ws["!ref"]).s.r;
    const grid = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });

    const found = findHeader(grid);
    if (!found) continue;
    const { index: headerIndex, columns } = found;

    const above = grid.slice(0, headerIndex).map(rowText);
    const rows: ParsedRow[] = [];
    for (let r = headerIndex + 1; r < grid.length; r++) {
      const result = parseRow(grid[r] ?? [], columns, date1904, firstRow + r + 1);
      if (result === null) continue;
      if ("error" in result) return result;
      rows.push(result);
    }
    if (rows.length > 1 && rows[0].occurredAt > rows[rows.length - 1].occurredAt) rows.reverse();

    const account = findAccountNumber(above);
    const period = findPeriod(above);
    return {
      accountDigits: account.digits,
      numberMasked: account.masked,
      kindHint: guessKind([sheetName, ...above].join(" ")),
      periodStart: period?.start ?? null,
      periodEnd: period?.end ?? null,
      rows,
    };
  }
  return { error: HEADER_NOT_FOUND_MESSAGE };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((b, i) => bytes[i] === b);
}

const ZIP = [0x50, 0x4b, 0x03, 0x04]; // .xlsx
const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // .xls (BIFF), encrypted .xlsx

function readWorkbook(bytes: Uint8Array): XLSX.WorkBook {
  if (startsWith(bytes, ZIP) || startsWith(bytes, CFB)) {
    // Binary workbooks: numbers stay numbers, dates come as Excel serials.
    return XLSX.read(bytes, { type: "array", cellDates: false, cellHTML: false, cellFormula: false });
  }
  // Text formats (HTML saved as .xls, CSV): decode ourselves (UTF-8 or EUC-KR)
  // and keep every value as the original string, so dates are never shifted
  // by the server's time zone and "00123"-style numbers are parsed by us.
  return XLSX.read(decodeText(bytes), { type: "string", raw: true, cellDates: false });
}

function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("euc-kr").decode(bytes);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function cellText(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return "";
  return String(cell).replace(/ /g, " ").trim();
}

function rowText(row: Cell[] | undefined): string {
  return (row ?? []).map(cellText).filter(Boolean).join(" ");
}

function isBlank(row: Cell[]): boolean {
  return row.every((cell) => cellText(cell) === "");
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export function normalizeHeader(cell: Cell): string {
  return cellText(cell)
    .replace(/[(（[][^)）\]]*[)）\]]/g, "")
    .replace(/[\s()（）[\]]/g, "");
}

function findHeader(grid: Cell[][]): { index: number; columns: Columns } | null {
  const limit = Math.min(grid.length, HEADER_SEARCH_ROWS);
  for (let r = 0; r < limit; r++) {
    const names = (grid[r] ?? []).map(normalizeHeader);
    const col = (field: Field): number | null => {
      const i = names.findIndex((name) => SYNONYMS[field].includes(name));
      return i === -1 ? null : i;
    };
    const date = col("date");
    const balance = col("balance");
    const withdrawal = col("withdrawal");
    const deposit = col("deposit");
    if (date === null || balance === null || (withdrawal === null && deposit === null)) continue;

    const descriptions: number[] = [];
    for (const synonym of SYNONYMS.description) {
      names.forEach((name, i) => {
        if (name === synonym && !descriptions.includes(i)) descriptions.push(i);
      });
    }
    return { index: r, columns: { date, time: col("time"), descriptions, withdrawal, deposit, balance } };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** null = blank cell, NaN = not a number. */
function parseAmount(cell: Cell): number | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "number") return Number.isFinite(cell) ? Math.round(cell) : Number.NaN;
  if (typeof cell !== "string") return Number.NaN;
  const text = cell
    .replace(/[\s, 원₩]/g, "")
    .replace(/^\+/, "")
    .replace(/[−–]/g, "-");
  if (text === "" || text === "-") return null;
  if (!/^-?\d+(\.\d+)?$/.test(text)) return Number.NaN;
  return Math.round(Number(text));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function validDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1990 || y > 2999) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function validTime(h: number, mi: number, s: number): string | null {
  if (h > 23 || mi > 59 || s > 59) return null;
  return `${pad2(h)}:${pad2(mi)}:${pad2(s)}`;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function fromSerial(serial: number, date1904: boolean): { date: string; time: string } | null {
  if (!(serial >= 1 && serial < 2_958_466)) return null;
  const totalSeconds = Math.round(serial * 86_400) + (date1904 ? 1462 * 86_400 : 0);
  const dt = new Date(EXCEL_EPOCH_MS + totalSeconds * 1000);
  const date = validDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  if (!date) return null;
  return { date, time: `${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}:${pad2(dt.getUTCSeconds())}` };
}

const DATE_TEXT =
  /^(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?\.?(?:\s*[T\s]\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const COMPACT_DATE_TEXT = /^(\d{4})(\d{2})(\d{2})(?:\s*(\d{2}):?(\d{2}):?(\d{2})?)?$/;

/** Date (and maybe time) from the date cell. time is null when the cell has none. */
function parseDateCell(cell: Cell, date1904: boolean): { date: string; time: string | null } | null {
  if (typeof cell === "number") {
    if (Number.isInteger(cell) && cell >= 19900101 && cell <= 29991231) {
      const date = validDate(Math.floor(cell / 10000), Math.floor(cell / 100) % 100, cell % 100);
      return date ? { date, time: null } : null;
    }
    const parsed = fromSerial(cell, date1904);
    if (!parsed) return null;
    return { date: parsed.date, time: Number.isInteger(cell) ? null : parsed.time };
  }
  const text = cellText(cell);
  if (!text) return null;
  const match = DATE_TEXT.exec(text) ?? COMPACT_DATE_TEXT.exec(text);
  if (!match) return null;
  const date = validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  if (!date) return null;
  if (match[4] === undefined) return { date, time: null };
  const time = validTime(Number(match[4]), Number(match[5]), Number(match[6] ?? 0));
  return time ? { date, time } : null;
}

function parseTimeCell(cell: Cell): string | null {
  if (typeof cell === "number") {
    if (cell >= 0 && cell < 1) {
      const seconds = Math.min(Math.round(cell * 86_400), 86_399);
      return validTime(Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60);
    }
    if (Number.isInteger(cell) && cell >= 0 && cell <= 235959) {
      return validTime(Math.floor(cell / 10000), Math.floor(cell / 100) % 100, cell % 100);
    }
    return null;
  }
  const text = cellText(cell);
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text) ?? /^(\d{2})(\d{2})(\d{2})?$/.exec(text);
  if (!match) return null;
  return validTime(Number(match[1]), Number(match[2]), Number(match[3] ?? 0));
}

function rowError(rowNumber: number, problem: string): ParseError {
  return { error: `${rowNumber}번째 줄${problem} ${FIX_HINT}` };
}

/** A parsed row, null for rows to skip (blank, 합계, notes), or an error that rejects the file. */
function parseRow(row: Cell[], cols: Columns, date1904: boolean, rowNumber: number): ParsedRow | ParseError | null {
  if (isBlank(row)) return null;

  const balance = parseAmount(row[cols.balance]);
  const withdrawal = cols.withdrawal === null ? null : parseAmount(row[cols.withdrawal]);
  const deposit = cols.deposit === null ? null : parseAmount(row[cols.deposit]);
  const hasAmounts = (withdrawal !== null && withdrawal !== 0) || (deposit !== null && deposit !== 0);
  const when = parseDateCell(row[cols.date], date1904);

  if (!when) {
    // 합계 / 안내 rows have no balance (or no amounts). A row with a balance and
    // amounts but no readable date is a transaction we cannot place.
    if (balance === null || Number.isNaN(balance) || !hasAmounts) return null;
    return rowError(rowNumber, "의 거래 날짜를 읽지 못했어요.");
  }
  if (Number.isNaN(withdrawal) || Number.isNaN(deposit) || Number.isNaN(balance)) {
    return rowError(rowNumber, "의 금액을 읽지 못했어요.");
  }
  if (balance === null) {
    if (!hasAmounts) return null;
    return rowError(rowNumber, "에 잔액이 비어 있어요.");
  }

  let time = when.time;
  if (cols.time !== null && cellText(row[cols.time]) !== "") {
    const fromColumn = parseTimeCell(row[cols.time]);
    if (!fromColumn) return rowError(rowNumber, "의 거래 시간을 읽지 못했어요.");
    time = fromColumn;
  }

  let description = "";
  for (const i of cols.descriptions) {
    const text = cellText(row[i]).replace(/\s+/g, " ");
    if (text) {
      description = text;
      break;
    }
  }

  return {
    occurredAt: `${when.date}T${time ?? "00:00:00"}+09:00`,
    description,
    withdrawal: withdrawal ?? 0,
    deposit: deposit ?? 0,
    balanceAfter: balance,
  };
}

// ---------------------------------------------------------------------------
// Title cells: account number, period, kind
// ---------------------------------------------------------------------------

const ACCOUNT_NUMBER = /(?<![\d*])(\d{3})-(\d{2,3})-(\d{6})(?![\d*])/;
const MASKED_ACCOUNT_NUMBER = /(?<![\d*])([\d*]{3}-[\d*]{2,3}-[\d*]{6})(?![\d*])/;
const LABELED_DIGITS = /계좌번호\s*[:：]?\s*(\d{10,14})(?!\d)/;

function maskNumber(first: string, middle: string, last: string): string {
  return `${first}-${"*".repeat(middle.length)}-${last}`;
}

function findAccountNumber(lines: string[]): { digits: string | null; masked: string | null } {
  for (const line of lines) {
    const full = ACCOUNT_NUMBER.exec(line);
    if (full) return { digits: full[1] + full[2] + full[3], masked: maskNumber(full[1], full[2], full[3]) };
  }
  for (const line of lines) {
    const labeled = LABELED_DIGITS.exec(line);
    if (labeled) {
      const d = labeled[1];
      return { digits: d, masked: `${d.slice(0, 3)}-${"*".repeat(d.length - 9)}-${d.slice(-6)}` };
    }
  }
  for (const line of lines) {
    const masked = MASKED_ACCOUNT_NUMBER.exec(line);
    if (masked && masked[1].includes("*")) return { digits: null, masked: masked[1] };
  }
  return { digits: null, masked: null };
}

const DATE_PART = String.raw`(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?`;
const PERIOD = new RegExp(`${DATE_PART}\\s*[~∼〜]\\s*${DATE_PART}`);

function findPeriod(lines: string[]): { start: string; end: string } | null {
  for (const line of lines) {
    const m = PERIOD.exec(line);
    if (!m) continue;
    const start = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    const end = validDate(Number(m[4]), Number(m[5]), Number(m[6]));
    if (start && end) return start <= end ? { start, end } : { start: end, end: start };
  }
  return null;
}

function guessKind(text: string): AccountKind | null {
  if (/적금/.test(text)) return "savings";
  if (/증권|투자|CMA|펀드|ISA/i.test(text)) return "investment";
  if (/입출금|보통예금|저축예금|주거래|자유입출/.test(text)) return "checking";
  return null;
}
