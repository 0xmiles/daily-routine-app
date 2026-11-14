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
  it("shows the schedule as a sentence and saves the weekday right away", async () => {
    render(<ReminderSettings />);
    expect(await screen.findByText(/매주 일요일/)).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("요일"), "월요일");
    await waitFor(() => expect(puts()).toEqual([{ uploadReminderDow: 1 }]));
    expect(await screen.findByText("저장했어요.")).toBeTruthy();
    expect(screen.getByText(/매주 월요일/)).toBeTruthy();
  });

  it("saves a time once typing settles", async () => {
    render(<ReminderSettings />);
    const time = await screen.findByLabelText("시간");
    fireEvent.change(time, { target: { value: "21:30" } });
    expect(puts()).toEqual([]);
    await waitFor(() => expect(puts()).toEqual([{ uploadReminderTime: "21:30" }]), { timeout: 2000 });
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
