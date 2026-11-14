import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@/shared/contracts";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/calendar/client", () => ({
  fetchEvents: vi.fn(),
  createEvent: vi.fn(async () => ({})),
  updateEvent: vi.fn(async () => ({})),
  deleteEvent: vi.fn(),
}));

import { createEvent, fetchEvents, updateEvent } from "@/features/calendar/client";
import { resetPersonalConnectedForTests, setPersonalConnected } from "@/features/shell/personalConnection";
import { buildEventInput, EventEditorSheet } from "./EventEditorSheet";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T05:20:00Z")); // 14:20 KST
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
  resetPersonalConnectedForTests();
  vi.mocked(createEvent).mockClear();
  vi.mocked(updateEvent).mockClear();
  vi.mocked(fetchEvents).mockResolvedValue({ events: [], workStatus: "connected", personalConnected: true });
});

describe("EventEditorSheet", () => {
  it("creates a timed event in Seoul time, defaulting to the next full hour", async () => {
    const onClose = vi.fn();
    render(<EventEditorSheet open initialTitle="치과" onClose={onClose} />);
    expect((screen.getByLabelText("시작") as HTMLInputElement).value).toBe("15:00");
    expect((screen.getByLabelText("끝") as HTMLInputElement).value).toBe("16:00");
    await userEvent.type(screen.getByLabelText("메모"), "보험증 챙기기");
    await userEvent.click(screen.getByRole("button", { name: "일정 만들기" }));
    expect(createEvent).toHaveBeenCalledWith({
      title: "치과",
      start: "2026-11-14T15:00:00+09:00",
      end: "2026-11-14T16:00:00+09:00",
      allDay: false,
      description: "보험증 챙기기",
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("all-day events send an exclusive end date", () => {
    expect(
      buildEventInput({ title: "휴가", date: "2026-11-20", allDay: true, startTime: "", endTime: "", spanDays: 1, memo: "" }),
    ).toEqual({ title: "휴가", start: "2026-11-20", end: "2026-11-21", allDay: true });
  });

  it("says what to fix", () => {
    const base = { title: "x", date: "2026-11-20", allDay: false, startTime: "10:00", endTime: "09:00", spanDays: 0, memo: "" };
    expect(buildEventInput({ ...base, title: " " })).toEqual({ error: "제목을 적어 주세요." });
    expect(buildEventInput(base)).toEqual({ error: "끝나는 시간은 시작 시간보다 늦어야 해요." });
    expect(buildEventInput({ ...base, endTime: "00:00" })).toMatchObject({ end: "2026-11-21T00:00:00+09:00" });
  });

  it("asks to connect the personal calendar instead of showing the form", async () => {
    vi.mocked(fetchEvents).mockResolvedValue({ events: [], workStatus: "connected", personalConnected: false });
    render(<EventEditorSheet open onClose={() => {}} />);
    expect(await screen.findByText(/개인 캘린더를 연결하면 새 일정을 추가할 수 있어요\./)).toBeTruthy();
    expect(screen.queryByLabelText("제목")).toBeNull();
  });

  it("shows the server's message when the write is rejected", async () => {
    setPersonalConnected(true);
    vi.mocked(createEvent).mockRejectedValueOnce(
      Object.assign(new Error("개인 캘린더가 연결되어 있지 않아요. 설정에서 연결해 주세요."), { status: 409 }),
    );
    render(<EventEditorSheet open initialTitle="치과" onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "일정 만들기" }));
    expect((await screen.findByRole("alert")).textContent).toBe("개인 캘린더가 연결되어 있지 않아요. 설정에서 연결해 주세요.");
  });

  it("edits a personal event without wiping its description", async () => {
    const event: CalendarEvent = {
      id: "p1",
      calendarId: "primary",
      source: "personal",
      title: "브런치",
      busyOnly: false,
      start: "2026-11-14T12:00:00+09:00",
      end: "2026-11-14T13:00:00+09:00",
      allDay: false,
      location: null,
      attendeeCount: null,
      recurringEventId: null,
      readOnly: false,
    };
    render(<EventEditorSheet open event={event} onClose={() => {}} />);
    const title = screen.getByLabelText("제목");
    await userEvent.clear(title);
    await userEvent.type(title, "늦은 브런치");
    await userEvent.click(screen.getByRole("button", { name: "고친 내용 저장하기" }));
    expect(updateEvent).toHaveBeenCalledWith("p1", {
      title: "늦은 브런치",
      start: "2026-11-14T12:00:00+09:00",
      end: "2026-11-14T13:00:00+09:00",
      allDay: false,
    });
  });
});
