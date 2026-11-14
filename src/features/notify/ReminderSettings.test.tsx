import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { offsetLabel, ReminderSettings } from "./ReminderSettings";

const defaults = { uploadReminderDow: 0, uploadReminderTime: "20:00", defaultOffsetMin: 30, dateOnlyNotifyTime: "09:00" };
let fetchSpy: MockInstance<typeof fetch>;
let server = { ...defaults };

beforeEach(() => {
  server = { ...defaults };
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    if (init?.method === "PUT") server = { ...server, ...JSON.parse(String(init.body)) };
    return new Response(JSON.stringify(server), { status: 200 });
  });
});
afterEach(() => fetchSpy.mockRestore());

const puts = () =>
  fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PUT").map(([, init]) => JSON.parse(String((init as RequestInit).body)));

describe("ReminderSettings", () => {
  it("leaves out the 거래내역 reminder while 자산 is turned off", async () => {
    render(<ReminderSettings />);
    expect(await screen.findByText("할 일 기본 알림")).toBeTruthy();
    expect(screen.queryByText("거래내역 올리기 알림")).toBeNull();
    expect(screen.queryByLabelText("요일")).toBeNull();
  });

  it("saves a time once typing settles", async () => {
    render(<ReminderSettings />);
    const time = await screen.findByLabelText("날짜만 있으면 그날");
    fireEvent.change(time, { target: { value: "08:30" } });
    expect(puts()).toEqual([]);
    await waitFor(() => expect(puts()).toEqual([{ dateOnlyNotifyTime: "08:30" }]), { timeout: 2000 });
  });

  it("saves the default todo offset", async () => {
    render(<ReminderSettings />);
    await userEvent.selectOptions(await screen.findByLabelText("마감 시간이 있으면"), "1시간 전");
    await waitFor(() => expect(puts()).toEqual([{ defaultOffsetMin: 60 }]));
  });

  it("labels offsets in words", () => {
    expect([0, 10, 60, 120, 1440].map(offsetLabel)).toEqual(["마감 시각에", "10분 전", "1시간 전", "2시간 전", "하루 전"]);
  });
});
