import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  HEADER_NOT_FOUND_MESSAGE,
  isParseError,
  parseShinhanWorkbook,
  type ParsedStatement,
  type ParseError,
} from "./shinhan";

// Synthetic workbooks are built in-test with SheetJS, the same library the
// parser uses, so no real (personal) bank files are needed.
function workbook(aoa: unknown[][], sheetName = "거래내역"): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

function bytes(text: string): ArrayBuffer {
  const u8 = new TextEncoder().encode(text);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function ok(result: ParsedStatement | ParseError): ParsedStatement {
  if (isParseError(result)) throw new Error(`expected a statement, got error: ${result.error}`);
  return result;
}

// EUC-KR encoder for tests: build the reverse map from the platform decoder.
let eucKrMap: Map<string, number[]> | undefined;
function eucKr(text: string): ArrayBuffer {
  if (!eucKrMap) {
    eucKrMap = new Map();
    const decoder = new TextDecoder("euc-kr");
    for (let hi = 0xa1; hi <= 0xfe; hi++) {
      for (let lo = 0xa1; lo <= 0xfe; lo++) {
        const ch = decoder.decode(new Uint8Array([hi, lo]));
        if (ch.length === 1 && ch !== "�" && !eucKrMap.has(ch)) eucKrMap.set(ch, [hi, lo]);
      }
    }
  }
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) out.push(code);
    else {
      const pair = eucKrMap.get(ch);
      if (!pair) throw new Error(`no EUC-KR mapping for ${ch}`);
      out.push(...pair);
    }
  }
  return new Uint8Array(out).buffer;
}

describe("parseShinhanWorkbook", () => {
  it("finds header below title rows", () => {
    const buf = workbook([
      ["입출금 거래내역조회"],
      [],
      ["계좌번호 : 110-123-456789", null, "예금주 : 홍길동"],
      ["조회기간 : 2026.10.01 ~ 2026.11.10"],
      ["조회일시 : 2026.11.10 21:00:00"],
      [],
      ["거래일자", "거래시간", "적요", "출금(원)", "입금(원)", "내용", "잔액(원)", "거래점"],
      ["2026.11.03", "08:30:00", "자동이체", "182,000", "", "관리비", "1,336,967", "본점"],
      ["2026.11.05", "12:00:01", "인터넷", 500000, null, "적금", 836967, "본점"],
      ["2026.11.10", "09:12:33", "급여", "", "3,200,000", "", "4,036,967", "본점"],
    ]);

    const parsed = ok(parseShinhanWorkbook(buf));

    expect(parsed.accountDigits).toBe("110123456789");
    expect(parsed.numberMasked).toBe("110-***-456789");
    expect(parsed.periodStart).toBe("2026-10-01");
    expect(parsed.periodEnd).toBe("2026-11-10");
    expect(parsed.kindHint).toBe("checking");
    expect(parsed.rows).toEqual([
      { occurredAt: "2026-11-03T08:30:00+09:00", description: "관리비", withdrawal: 182000, deposit: 0, balanceAfter: 1336967 },
      { occurredAt: "2026-11-05T12:00:01+09:00", description: "적금", withdrawal: 500000, deposit: 0, balanceAfter: 836967 },
      // 내용 is blank on this row → falls back to 적요
      { occurredAt: "2026-11-10T09:12:33+09:00", description: "급여", withdrawal: 0, deposit: 3200000, balanceAfter: 4036967 },
    ]);
  });

  it("parses 찾으신금액/맡기신금액 layout", () => {
    const buf = workbook([
      ["신한 적금 거래내역"],
      ["계좌번호", "230-45-678901"],
      ["조회기간", "2026-09-01 ~ 2026-11-10"],
      ["거래 일시", "기재 내용", "찾으신금액(원)", "맡기신금액(원)", "거래후 잔액(원)"],
      ["2026.11.10 09:12:33", "카드대금", "802,400", "0", "34,567"],
      ["2026-11-10 10:00", "급여", "", "3,200,000", "3,234,567"],
    ]);

    const parsed = ok(parseShinhanWorkbook(buf));

    expect(parsed.accountDigits).toBe("23045678901");
    expect(parsed.kindHint).toBe("savings");
    expect(parsed.periodStart).toBe("2026-09-01");
    expect(parsed.periodEnd).toBe("2026-11-10");
    expect(parsed.rows).toEqual([
      { occurredAt: "2026-11-10T09:12:33+09:00", description: "카드대금", withdrawal: 802400, deposit: 0, balanceAfter: 34567 },
      { occurredAt: "2026-11-10T10:00:00+09:00", description: "급여", withdrawal: 0, deposit: 3200000, balanceAfter: 3234567 },
    ]);
  });

  it('missing header returns error "거래내역 표를 찾지 못했어요. 신한 인터넷뱅킹에서 받은 거래내역 엑셀인지 확인해 주세요."', () => {
    const buf = workbook([
      ["가계부"],
      ["날짜", "항목", "금액"],
      ["2026.11.10", "커피", 4500],
    ]);
    expect(parseShinhanWorkbook(buf)).toEqual({
      error: "거래내역 표를 찾지 못했어요. 신한 인터넷뱅킹에서 받은 거래내역 엑셀인지 확인해 주세요.",
    });
    expect(HEADER_NOT_FOUND_MESSAGE).toBe(
      "거래내역 표를 찾지 못했어요. 신한 인터넷뱅킹에서 받은 거래내역 엑셀인지 확인해 주세요.",
    );
  });

  it("returns the header error for a file that is not a spreadsheet", () => {
    expect(parseShinhanWorkbook(new Uint8Array([1, 2, 3, 4, 5]).buffer)).toEqual({ error: HEADER_NOT_FOUND_MESSAGE });
    expect(parseShinhanWorkbook(new ArrayBuffer(0))).toEqual({ error: HEADER_NOT_FOUND_MESSAGE });
  });

  it("only looks for the header in the first 30 rows", () => {
    const filler = Array.from({ length: 30 }, (_, i) => [`안내 ${i + 1}`]);
    const buf = workbook([...filler, ["거래일자", "출금", "입금", "잔액"], ["2026.11.10", 1000, 0, 5000]]);
    expect(parseShinhanWorkbook(buf)).toEqual({ error: HEADER_NOT_FOUND_MESSAGE });
  });

  it("reads an HTML table saved as .xls", () => {
    const html = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body>
      <table>
        <tr><td colspan="5">신한은행 거래내역조회</td></tr>
        <tr><td>계좌번호</td><td>110-123-456789</td></tr>
        <tr><td>조회기간</td><td>2026/11/01</td><td>~</td><td>2026/11/10</td></tr>
        <tr><th>거래일자</th><th>거래시간</th><th>적요</th><th>출금액</th><th>입금액</th><th>잔액</th></tr>
        <tr><td>2026/11/09</td><td>18:20</td><td>카드대금</td><td>802,400</td><td></td><td>00034,567</td></tr>
        <tr><td>2026/11/10</td><td>09:12:33</td><td>급여</td><td>0</td><td>3,200,000</td><td>3,234,567</td></tr>
      </table></body></html>`;

    const parsed = ok(parseShinhanWorkbook(bytes(html)));

    expect(parsed.accountDigits).toBe("110123456789");
    expect(parsed.periodStart).toBe("2026-11-01");
    expect(parsed.periodEnd).toBe("2026-11-10");
    expect(parsed.rows).toEqual([
      { occurredAt: "2026-11-09T18:20:00+09:00", description: "카드대금", withdrawal: 802400, deposit: 0, balanceAfter: 34567 },
      { occurredAt: "2026-11-10T09:12:33+09:00", description: "급여", withdrawal: 0, deposit: 3200000, balanceAfter: 3234567 },
    ]);
  });

  it("reads an EUC-KR encoded HTML table", () => {
    const html =
      '<html><head><meta charset="euc-kr"></head><body><table>' +
      "<tr><td>계좌번호 : 110-123-456789</td></tr>" +
      "<tr><td>거래일자</td><td>내용</td><td>출금</td><td>입금</td><td>잔액</td></tr>" +
      "<tr><td>2026.11.10</td><td>커피</td><td>4,500</td><td></td><td>5,500</td></tr>" +
      "</table></body></html>";

    const parsed = ok(parseShinhanWorkbook(eucKr(html)));

    expect(parsed.accountDigits).toBe("110123456789");
    expect(parsed.rows).toEqual([
      { occurredAt: "2026-11-10T00:00:00+09:00", description: "커피", withdrawal: 4500, deposit: 0, balanceAfter: 5500 },
    ]);
  });

  it("reads a UTF-8 CSV with a byte order mark", () => {
    const csv = '﻿거래일자,거래시간,적요,출금(원),입금(원),잔액(원)\n2026-11-10,09:12:33,커피,"4,500",,"5,500"\n';
    const parsed = ok(parseShinhanWorkbook(bytes(csv)));
    expect(parsed.accountDigits).toBeNull();
    expect(parsed.numberMasked).toBeNull();
    expect(parsed.periodEnd).toBeNull();
    expect(parsed.rows).toEqual([
      { occurredAt: "2026-11-10T09:12:33+09:00", description: "커피", withdrawal: 4500, deposit: 0, balanceAfter: 5500 },
    ]);
  });

  it("reads Excel serial dates and times", () => {
    // 46336 = 2026-11-10; 0.38375 of a day = 09:12:36
    const buf = workbook([
      ["거래일시", "적요", "출금", "입금", "잔액"],
      [46336.38375, "커피", 4500, 0, 5500],
    ]);
    const buf2 = workbook([
      ["거래일자", "거래시간", "적요", "출금", "입금", "잔액"],
      [46336, 0.5, "점심", 9000, 0, 1000],
    ]);
    expect(ok(parseShinhanWorkbook(buf)).rows[0].occurredAt).toBe("2026-11-10T09:12:36+09:00");
    expect(ok(parseShinhanWorkbook(buf2)).rows[0].occurredAt).toBe("2026-11-10T12:00:00+09:00");
  });

  it("skips summary and note rows without a balance", () => {
    const buf = workbook([
      ["거래일자", "적요", "출금", "입금", "잔액"],
      ["2026.11.09", "커피", "4,500", "", "5,500"],
      ["", "", "", "", ""],
      ["합계", "", "4,500", "0", ""],
      ["※ 위 내역은 조회 시점 기준이에요."],
    ]);
    const parsed = ok(parseShinhanWorkbook(buf));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].description).toBe("커피");
  });

  it("returns newest-first files in chronological order", () => {
    const buf = workbook([
      ["거래일자", "거래시간", "적요", "출금", "입금", "잔액"],
      ["2026.11.10", "09:00:00", "급여", 0, 3200000, 3234567],
      ["2026.11.09", "18:20:00", "카드대금", 802400, 0, 34567],
      ["2026.11.03", "08:30:00", "관리비", 182000, 0, 836967],
    ]);
    expect(ok(parseShinhanWorkbook(buf)).rows.map((r) => r.description)).toEqual(["관리비", "카드대금", "급여"]);
  });

  it("rejects the whole file when a transaction row cannot be read", () => {
    const badDate = workbook([
      ["거래일자", "적요", "출금", "입금", "잔액"],
      ["2026.11.09", "커피", 4500, 0, 5500],
      ["어제", "점심", 9000, 0, 1000],
    ]);
    const badAmount = workbook([
      ["거래일자", "적요", "출금", "입금", "잔액"],
      ["2026.11.09", "커피", "사천오백", 0, 5500],
    ]);
    const noBalance = workbook([
      ["거래일자", "적요", "출금", "입금", "잔액"],
      ["2026.11.09", "커피", 4500, 0, ""],
    ]);

    const e1 = parseShinhanWorkbook(badDate);
    const e2 = parseShinhanWorkbook(badAmount);
    const e3 = parseShinhanWorkbook(noBalance);

    expect(isParseError(e1) && e1.error).toBe(
      "3번째 줄의 거래 날짜를 읽지 못했어요. 신한 인터넷뱅킹에서 받은 파일을 고치지 않고 그대로 올려 주세요.",
    );
    expect(isParseError(e2) && e2.error).toBe(
      "2번째 줄의 금액을 읽지 못했어요. 신한 인터넷뱅킹에서 받은 파일을 고치지 않고 그대로 올려 주세요.",
    );
    expect(isParseError(e3) && e3.error).toBe(
      "2번째 줄에 잔액이 비어 있어요. 신한 인터넷뱅킹에서 받은 파일을 고치지 않고 그대로 올려 주세요.",
    );
  });

  it("guesses the account kind from the title", () => {
    const rows = [["거래일자", "적요", "출금", "입금", "잔액"]];
    const kind = (title: string, sheet = "Sheet1") =>
      ok(parseShinhanWorkbook(workbook([[title], ...rows], sheet))).kindHint;
    expect(kind("신한 쏠편한 입출금통장 거래내역")).toBe("checking");
    expect(kind("신한 청년 적금 거래내역")).toBe("savings");
    expect(kind("신한투자증권 CMA 거래내역")).toBe("investment");
    expect(kind("거래내역조회")).toBeNull();
    expect(kind("거래내역조회", "적금 거래내역")).toBe("savings");
  });

  it("keeps a masked account number without digits", () => {
    const buf = workbook([
      ["계좌번호 : 110-***-456789"],
      ["거래일자", "적요", "출금", "입금", "잔액"],
      ["2026.11.09", "커피", 4500, 0, 5500],
    ]);
    const parsed = ok(parseShinhanWorkbook(buf));
    expect(parsed.accountDigits).toBeNull();
    expect(parsed.numberMasked).toBe("110-***-456789");
  });
});
