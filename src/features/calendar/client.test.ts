import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEvent, fetchEvents } from "./client";

const okJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T03:00:00Z"));
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterEach(() => {
  fetchSpy.mockRestore();
  vi.useRealTimers();
});

const urlOf = (call: unknown[]) => String(call[0]);

it("asks for fresh events for a minute after this browser wrote one", async () => {
  fetchSpy.mockImplementation(async () => okJson({ events: [], workStatus: "disconnected", personalConnected: true }));
  await fetchEvents("2026-11-14", "2026-11-14");
  expect(urlOf(fetchSpy.mock.calls.at(-1)!)).not.toContain("fresh=1");

  fetchSpy.mockImplementationOnce(async () => okJson({ id: "e1" }, 201));
  await createEvent({ title: "점심", start: "2026-11-14T12:00", end: "2026-11-14T13:00", allDay: false });
  await fetchEvents("2026-11-14", "2026-11-14");
  expect(urlOf(fetchSpy.mock.calls.at(-1)!)).toContain("fresh=1");

  vi.setSystemTime(new Date("2026-11-14T03:01:30Z"));
  await fetchEvents("2026-11-14", "2026-11-14");
  expect(urlOf(fetchSpy.mock.calls.at(-1)!)).not.toContain("fresh=1");
});
