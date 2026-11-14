import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRef, MemoBlock } from "@/shared/contracts";
import { MemoApiError, deleteBlock, fetchEventKeys, memoBlockHref, openEventMemo, saveBlock } from "./client";

const block: MemoBlock = {
  id: "11111111-1111-4111-8111-111111111111",
  content: "- ",
  createdAt: "2026-11-14T00:00:00.000Z",
  updatedAt: "2026-11-14T00:00:00.000Z",
  version: 1,
  eventRef: null,
};

const ref: EventRef = {
  eventKey: "primary:evt-9",
  calendarId: "primary",
  eventId: "evt-9",
  recurringEventId: null,
  source: "personal",
  title: "저녁 약속",
  start: "2026-11-14T19:00:00+09:00",
  end: "2026-11-14T21:00:00+09:00",
  allDay: false,
  deleted: false,
};

const fetchMock = vi.fn<typeof fetch>();
const respond = (data: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }));

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("memo client", () => {
  it("saveBlock returns ok:false with the server copy on 409", async () => {
    respond({ current: { ...block, content: "다른 기기", version: 3 } }, 409);
    const result = await saveBlock(block.id, "내 글", 2);
    expect(result).toEqual({ ok: false, current: { ...block, content: "다른 기기", version: 3 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/memo/blocks/${block.id}`);
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({ content: "내 글", baseVersion: 2 });
  });

  it("saveBlock returns ok:true with the saved block", async () => {
    respond({ ...block, content: "내 글", version: 2 });
    expect(await saveBlock(block.id, "내 글", 1)).toEqual({ ok: true, block: { ...block, content: "내 글", version: 2 } });
  });

  it("other errors reject with MemoApiError carrying the server message", async () => {
    respond({ message: "로그인이 필요해요." }, 401);
    const error = await saveBlock(block.id, "x", 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MemoApiError);
    expect(error).toMatchObject({ status: 401, message: "로그인이 필요해요." });
  });

  it("deleteBlock passes baseVersion when given", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await deleteBlock(block.id, 4)).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/memo/blocks/${block.id}?baseVersion=4`);
  });

  it("fetchEventKeys returns the keys", async () => {
    respond({ keys: ["primary:evt-9"] });
    expect(await fetchEventKeys()).toEqual(["primary:evt-9"]);
  });

  it("openEventMemo creates (or finds) the event block, then navigates to /memo?block=<id>", async () => {
    respond({ ...block, eventRef: ref }, 201);
    const navigate = vi.fn();
    const result = await openEventMemo(ref, navigate);
    expect(result.id).toBe(block.id);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ eventRef: ref });
    expect(navigate).toHaveBeenCalledWith(`/memo?block=${block.id}`);
    expect(memoBlockHref(block.id)).toBe(`/memo?block=${block.id}`);
  });

  it("openEventMemo defaults to window.location.assign", async () => {
    respond({ ...block, eventRef: ref }, 200);
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    await openEventMemo(ref);
    expect(assign).toHaveBeenCalledWith(`/memo?block=${block.id}`);
  });
});
