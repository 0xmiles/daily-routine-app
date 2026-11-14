import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetsSummary, BankAccount, Txn } from "@/shared/contracts";
import { addDays, seoulToday } from "@/shared/time";
import { AssetsPage } from "./AssetsPage";
import { Passbook } from "./Passbook";

const today = seoulToday();

function account(patch: Partial<BankAccount> = {}): BankAccount {
  return {
    id: "acc-1",
    kind: "checking",
    name: "신한 주거래",
    numberMasked: "110-***-456789",
    balance: 3_234_567,
    asOf: today,
    stale: false,
    manualValuation: null,
    ...patch,
  };
}

const THREE: BankAccount[] = [
  account(),
  account({ id: "acc-2", kind: "savings", name: "적금", numberMasked: null, balance: 12_000_000 }),
  account({ id: "acc-3", kind: "investment", name: "투자", numberMasked: null, balance: 8_245_433 }),
];

const TXNS: Txn[] = [
  {
    id: "t1",
    accountId: "acc-1",
    occurredAt: `${today}T08:30:00+09:00`,
    description: "관리비",
    withdrawal: 182_000,
    deposit: 0,
    balanceAfter: 1_336_967,
    isTransfer: false,
  },
  {
    id: "t2",
    accountId: "acc-1",
    occurredAt: `${today}T12:00:01+09:00`,
    description: "적금",
    withdrawal: 500_000,
    deposit: 0,
    balanceAfter: 836_967,
    isTransfer: true,
  },
];

function summaryOf(accounts: BankAccount[], flow?: Partial<AssetsSummary["flow"]>): AssetsSummary {
  return {
    accounts,
    total: accounts.reduce((s, a) => s + (a.balance ?? 0), 0),
    flow: { month: today.slice(0, 7), deposit: 3_200_000, withdrawal: 984_400, transfer: 500_000, ...flow },
  };
}

type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockApi(handler: Handler) {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal("fetch", fetchMock);
}

function calls(predicate: (url: string, init?: RequestInit) => boolean) {
  return fetchMock.mock.calls.filter(([url, init]) => predicate(String(url), init as RequestInit | undefined));
}

function sentence(text: string, tag = "P") {
  return (_: string, el: Element | null) => el?.tagName === tag && el.textContent === text;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AssetsPage", () => {
  it("summary sentence for 3 accounts", async () => {
    mockApi((url) => {
      if (url.startsWith("/api/assets/summary")) return json(summaryOf(THREE));
      if (url.startsWith("/api/assets/accounts/acc-1/txns")) return json({ txns: TXNS });
      return json({ txns: [] });
    });
    render(<AssetsPage />);

    expect(screen.getByRole("heading", { level: 1, name: "자산" })).toBeTruthy();
    expect(await screen.findByText(sentence("세 계좌를 합치면 23,480,000원이에요."))).toBeTruthy();
    expect(
      screen.getByText(
        sentence("11월에 3,200,000원 들어오고 984,400원 나갔어요. 내 계좌끼리 옮긴 500,000원은 뺐어요.".replace(
          "11월",
          `${Number(today.slice(5, 7))}월`,
        )),
      ),
    ).toBeTruthy();

    const pills = within(screen.getByRole("group", { name: "계좌 고르기" })).getAllByRole("button");
    expect(pills.map((p) => p.textContent)).toEqual(["신한 주거래", "적금", "투자"]);
    expect(pills[0].getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText("관리비")).toBeTruthy();

    await userEvent.click(pills[1]);
    expect(pills[1].getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(calls((u) => u.startsWith("/api/assets/accounts/acc-2/txns"))).toHaveLength(1));
  });

  it("says 모두 for a single account", async () => {
    mockApi((url) => (url.startsWith("/api/assets/summary") ? json(summaryOf([account()])) : json({ txns: [] })));
    render(<AssetsPage />);
    expect(await screen.findByText(sentence("모두 3,234,567원이에요."))).toBeTruthy();
  });

  it("empty state shows upload", async () => {
    mockApi(() => json(summaryOf([], { deposit: 0, withdrawal: 0, transfer: 0 })));
    render(<AssetsPage />);
    expect(
      await screen.findByText("신한 인터넷뱅킹에서 받은 거래내역 엑셀을 올리면 여기에 통장처럼 보여요."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "거래내역 엑셀 올리기" })).toBeTruthy();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.accept).toBe(".xls,.xlsx,.csv,.html");
  });

  it("toggles a transfer row through the API", async () => {
    mockApi((url, init) => {
      if (url.startsWith("/api/assets/summary")) return json(summaryOf([account()]));
      if (url.startsWith("/api/assets/txns/t1") && init?.method === "PATCH") {
        return json({ txn: { ...TXNS[0], isTransfer: true } });
      }
      return json({ txns: TXNS });
    });
    render(<AssetsPage />);

    const row = (await screen.findByText("관리비")).closest("tr")!;
    expect(row.className).not.toContain("transfer");
    await userEvent.click(row);

    await waitFor(() => expect(screen.getByText("관리비").closest("tr")!.className).toContain("transfer"));
    const patch = calls((u, init) => u === "/api/assets/txns/t1" && init?.method === "PATCH");
    expect(patch).toHaveLength(1);
    expect(JSON.parse(String((patch[0][1] as RequestInit).body))).toEqual({ isTransfer: true });
  });

  it("asks for the account on 409 and uploads again with it", async () => {
    window.localStorage.setItem("assets.lastUploadAccount", "acc-2");
    let uploads = 0;
    mockApi((url, init) => {
      if (url === "/api/assets/upload") {
        uploads += 1;
        const form = init?.body as FormData;
        if (!form.get("accountId")) {
          return json({ message: "어느 계좌의 거래내역인지 골라 주세요.", needsAccount: true }, 409);
        }
        return json({ account: THREE[1], inserted: 2, skipped: 1 });
      }
      if (url.startsWith("/api/assets/summary")) return json(summaryOf(THREE));
      return json({ txns: [] });
    });
    render(<AssetsPage />);
    await screen.findByText(sentence("세 계좌를 합치면 23,480,000원이에요."));

    const file = new File(["x"], "거래내역.xls");
    await userEvent.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, file);

    const dialog = await screen.findByRole("dialog", { name: "계좌 고르기" });
    expect(within(dialog).getByText("어느 계좌의 거래내역인지 골라 주세요.")).toBeTruthy();
    // the last chosen account is preselected
    expect((within(dialog).getByRole("radio", { name: "적금" }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(within(dialog).getByRole("button", { name: "이 계좌로 올리기" }));

    expect(await screen.findByText("적금에 거래 2건을 새로 넣었어요. 이미 있던 1건은 건너뛰었어요.")).toBeTruthy();
    expect(uploads).toBe(2);
    const second = calls((u) => u === "/api/assets/upload")[1][1] as RequestInit;
    expect((second.body as FormData).get("accountId")).toBe("acc-2");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the server message for a file it cannot read", async () => {
    const message = "거래내역 표를 찾지 못했어요. 신한 인터넷뱅킹에서 받은 거래내역 엑셀인지 확인해 주세요.";
    mockApi((url) => {
      if (url === "/api/assets/upload") return json({ message }, 422);
      return json(summaryOf([], { deposit: 0, withdrawal: 0, transfer: 0 }));
    });
    render(<AssetsPage />);
    await screen.findByRole("button", { name: "거래내역 엑셀 올리기" });

    await userEvent.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, new File(["x"], "a.xlsx"));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });

  it("warns about an old investment amount and lets me enter it now", async () => {
    const enteredOn = addDays(today, -18);
    const investment = account({
      id: "acc-3",
      kind: "investment",
      name: "투자계좌",
      numberMasked: null,
      balance: 5_000_000,
      asOf: enteredOn,
      stale: true,
      manualValuation: { amount: 5_000_000, enteredAt: `${enteredOn}T10:00:00+09:00` },
    });
    mockApi((url, init) => {
      if (url === "/api/assets/accounts/acc-3/valuation" && init?.method === "PUT") {
        return json({ account: { ...investment, balance: 6_000_000, asOf: today, stale: false } });
      }
      if (url.startsWith("/api/assets/summary")) return json(summaryOf([account(), investment]));
      return json({ txns: [] });
    });
    render(<AssetsPage />);

    const warning = await screen.findByText(sentence("투자계좌 금액은 18일 전에 입력했어요.", "STRONG"));
    expect(warning.className).toContain("stale");
    await userEvent.click(screen.getByRole("button", { name: "지금 금액 입력하기" }));

    const dialog = await screen.findByRole("dialog");
    const amount = within(dialog).getByLabelText("지금 평가금액") as HTMLInputElement;
    expect(amount.value).toBe("5,000,000"); // starts from the last entered amount
    await userEvent.clear(amount);
    await userEvent.type(amount, "6,000,000");
    await userEvent.click(within(dialog).getByRole("button", { name: "금액 저장하기" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const put = calls((u, init) => u === "/api/assets/accounts/acc-3/valuation" && init?.method === "PUT");
    expect(JSON.parse(String((put[0][1] as RequestInit).body))).toEqual({ amount: 6_000_000 });
  });

  it("always offers to enter an investment amount", async () => {
    const investment = account({
      id: "acc-3",
      kind: "investment",
      name: "신한 투자",
      numberMasked: null,
      asOf: today,
      manualValuation: { amount: 3_234_567, enteredAt: `${today}T10:00:00+09:00` },
    });
    mockApi((url) => (url.startsWith("/api/assets/summary") ? json(summaryOf([investment])) : json({ txns: [] })));
    render(<AssetsPage />);

    const label = `${Number(today.slice(5, 7))}월 ${Number(today.slice(8, 10))}일에 직접 입력한 금액이에요. 지금 금액 입력하기`;
    expect(await screen.findByText(sentence(label))).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "지금 금액 입력하기" }));
    expect(await screen.findByRole("dialog", { name: "신한 투자 금액 입력하기" })).toBeTruthy();
  });

  it("uploads a file dropped anywhere on the page", async () => {
    mockApi((url) => {
      if (url === "/api/assets/upload") return json({ account: account(), inserted: 4, skipped: 0 });
      if (url.startsWith("/api/assets/summary")) return json(summaryOf([account()]));
      return json({ txns: [] });
    });
    render(<AssetsPage />);
    await screen.findByText(sentence("모두 3,234,567원이에요."));

    const file = new File(["x"], "거래내역.xlsx");
    const dataTransfer = { types: ["Files"], files: [file], dropEffect: "none" };
    act(() => {
      fireEvent.dragEnter(window, { dataTransfer });
    });
    expect(await screen.findByText("여기에 놓으면 거래내역을 올려요.")).toBeTruthy();
    act(() => {
      fireEvent.drop(window, { dataTransfer });
    });

    expect(await screen.findByText("신한 주거래에 거래 4건을 새로 넣었어요.")).toBeTruthy();
    expect(screen.queryByText("여기에 놓으면 거래내역을 올려요.")).toBeNull();
    const form = calls((u) => u === "/api/assets/upload")[0][1] as RequestInit;
    expect((form.body as FormData).get("file")).toBeInstanceOf(File);
  });
});

describe("Passbook", () => {
  it("transfer row muted with 이체", async () => {
    const onToggle = vi.fn();
    render(
      <Passbook
        account={account()}
        txns={TXNS}
        month={today.slice(0, 7)}
        canGoNext={false}
        onMonthChange={() => {}}
        onToggleTransfer={onToggle}
      />,
    );

    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["날짜", "내용", "찾으신 금액", "맡기신 금액", "잔액"]);

    const transferRow = screen.getByText("적금").closest("tr")!;
    expect(transferRow.className).toContain("transfer");
    expect(within(transferRow).getByText("이체")).toBeTruthy();

    const normalRow = screen.getByText("관리비").closest("tr")!;
    expect(normalRow.className).not.toContain("transfer");
    expect(within(normalRow).queryByText("이체")).toBeNull();

    await userEvent.click(within(transferRow).getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(TXNS[1]);
  });

  it("shows an empty month", () => {
    render(
      <Passbook
        account={account()}
        txns={[]}
        month="2026-10"
        canGoNext
        onMonthChange={() => {}}
        onToggleTransfer={() => {}}
      />,
    );
    expect(screen.getByText("10월에는 거래가 없어요.")).toBeTruthy();
  });
});
