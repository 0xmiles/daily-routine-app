import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as GET_BLOCKS, POST } from "@/app/api/memo/blocks/route";
import { DELETE, PATCH, PUT } from "@/app/api/memo/blocks/[id]/route";
import { POST as POST_FOLDER } from "@/app/api/memo/folders/route";
import { DELETE as DELETE_FOLDER, PATCH as PATCH_FOLDER } from "@/app/api/memo/folders/[id]/route";
import { GET as GET_KEYS } from "@/app/api/memo/event-keys/route";
import { sessionCookieFor } from "@/server/auth/session";
import type { Db } from "@/server/db/client";
import { memoBlocks } from "@/server/db/schema";
import { createTestDb } from "@/server/db/test-db";
import type { EventRef, MemoBlock, MemoFolder } from "@/shared/contracts";

let db: Db;
let cookie: string;

beforeEach(async () => {
  db = await createTestDb();
  cookie = await sessionCookieFor();
});

const BASE = "http://localhost/api/memo";

function req(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Request {
  const headers: Record<string, string> = {};
  if (init.auth !== false) headers.cookie = cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function eventRef(overrides: Partial<EventRef> = {}): EventRef {
  return {
    eventKey: "work-cal:evt-1",
    calendarId: "work-cal",
    eventId: "evt-1",
    recurringEventId: null,
    source: "work",
    title: "주간 회의",
    start: "2026-11-16T10:00:00+09:00",
    end: "2026-11-16T11:00:00+09:00",
    allDay: false,
    deleted: false,
    ...overrides,
  };
}

async function create(body: unknown): Promise<{ status: number; block: MemoBlock }> {
  const res = await POST(req("/blocks", { method: "POST", body }));
  return { status: res.status, block: (await res.json()) as MemoBlock };
}

describe("auth", () => {
  it("requires a session on every memo route", async () => {
    expect((await GET_BLOCKS(req("/blocks", { auth: false }))).status).toBe(401);
    expect((await POST(req("/blocks", { method: "POST", body: {}, auth: false }))).status).toBe(401);
    const id = "00000000-0000-4000-8000-000000000000";
    expect((await PUT(req(`/blocks/${id}`, { method: "PUT", body: { content: "x", baseVersion: 1 }, auth: false }), params(id))).status).toBe(401);
    expect((await DELETE(req(`/blocks/${id}`, { method: "DELETE", auth: false }), params(id))).status).toBe(401);
    expect((await GET_KEYS(req("/event-keys", { auth: false }))).status).toBe(401);
  });
});

describe("POST /api/memo/blocks", () => {
  it("creates a plain block with version 1", async () => {
    const { status, block } = await create({ content: "회의 안건" });
    expect(status).toBe(201);
    expect(block).toMatchObject({ content: "회의 안건", version: 1, eventRef: null });
    expect(typeof block.id).toBe("string");
    expect(new Date(block.createdAt).toISOString()).toBe(block.createdAt);
  });

  it("defaults content to an empty string", async () => {
    const { block } = await create({});
    expect(block.content).toBe("");
  });

  it('new event block content starts with "- "', async () => {
    const { status, block } = await create({ eventRef: eventRef() });
    expect(status).toBe(201);
    expect(block.content.startsWith("- ")).toBe(true);
    expect(block.eventRef).toMatchObject({ eventKey: "work-cal:evt-1", title: "주간 회의", source: "work" });
  });

  it("same eventKey returns existing block", async () => {
    const first = await create({ eventRef: eventRef() });
    // Edit it so we can tell the existing block from a new one.
    await PUT(req(`/blocks/${first.block.id}`, { method: "PUT", body: { content: "- 결정한 것", baseVersion: 1 } }), params(first.block.id));

    const again = await create({ eventRef: eventRef() });
    expect(again.status).toBe(200);
    expect(again.block.id).toBe(first.block.id);
    expect(again.block.content).toBe("- 결정한 것");
    expect(await db.select().from(memoBlocks)).toHaveLength(1);
  });

  it("refreshes the stored label when the event moved, without touching content or version", async () => {
    const first = await create({ eventRef: eventRef() });
    const moved = eventRef({ start: "2026-11-16T14:00:00+09:00", end: "2026-11-16T15:00:00+09:00" });
    const again = await create({ eventRef: moved });
    expect(again.status).toBe(200);
    expect(again.block.id).toBe(first.block.id);
    expect(again.block.eventRef?.start).toBe("2026-11-16T14:00:00+09:00");
    expect(again.block.version).toBe(first.block.version);
    expect(again.block.content).toBe(first.block.content);
  });

  it('uses "회사 일정" as the label title for busy-only work events', async () => {
    const { block } = await create({ eventRef: eventRef({ title: "" }) });
    expect(block.eventRef?.title).toBe("회사 일정");
  });

  it("rejects an invalid body with a Korean message", async () => {
    const res = await POST(req("/blocks", { method: "POST", body: { content: 3 } }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toMatch(/[가-힣]/);
  });
});

describe("GET /api/memo/blocks", () => {
  it("blocks ordered newest first", async () => {
    const [oldest, newest, middle] = await db
      .insert(memoBlocks)
      .values([
        { content: "가장 오래된 메모", createdAt: new Date("2026-11-12T00:00:00Z") },
        { content: "가장 새 메모", createdAt: new Date("2026-11-14T00:00:00Z") },
        { content: "중간 메모", createdAt: new Date("2026-11-13T00:00:00Z") },
      ])
      .returning();
    const res = await GET_BLOCKS(req("/blocks"));
    expect(res.status).toBe(200);
    const { blocks } = (await res.json()) as { blocks: MemoBlock[] };
    expect(blocks.map((b) => b.id)).toEqual([newest.id, middle.id, oldest.id]);
    expect(blocks[0]).toMatchObject({ content: "가장 새 메모", version: 1, eventRef: null, createdAt: "2026-11-14T00:00:00.000Z" });
  });
});

describe("PUT /api/memo/blocks/[id]", () => {
  it("saves content and bumps the version", async () => {
    const { block } = await create({ content: "처음" });
    const res = await PUT(req(`/blocks/${block.id}`, { method: "PUT", body: { content: "고친 내용", baseVersion: 1 } }), params(block.id));
    expect(res.status).toBe(200);
    const saved = (await res.json()) as MemoBlock;
    expect(saved).toMatchObject({ id: block.id, content: "고친 내용", version: 2 });
    expect(new Date(saved.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(block.updatedAt).getTime());
  });

  it("stale baseVersion returns 409 with current", async () => {
    const { block } = await create({ content: "처음" });
    // Device A saves first.
    const a = await PUT(req(`/blocks/${block.id}`, { method: "PUT", body: { content: "맥에서 쓴 내용", baseVersion: 1 } }), params(block.id));
    expect(a.status).toBe(200);
    // Device B still thinks the block is at version 1.
    const b = await PUT(req(`/blocks/${block.id}`, { method: "PUT", body: { content: "아이폰에서 쓴 내용", baseVersion: 1 } }), params(block.id));
    expect(b.status).toBe(409);
    const body = (await b.json()) as { current: MemoBlock };
    expect(body.current).toMatchObject({ id: block.id, content: "맥에서 쓴 내용", version: 2 });
    // Nothing was overwritten.
    const [row] = await db.select().from(memoBlocks).where(eq(memoBlocks.id, block.id));
    expect(row.content).toBe("맥에서 쓴 내용");
    expect(row.version).toBe(2);
  });

  it("returns 404 for a missing block and for a malformed id", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await PUT(req(`/blocks/${missing}`, { method: "PUT", body: { content: "x", baseVersion: 1 } }), params(missing))).status).toBe(404);
    expect((await PUT(req("/blocks/nope", { method: "PUT", body: { content: "x", baseVersion: 1 } }), params("nope"))).status).toBe(404);
  });

  it("rejects a body without baseVersion", async () => {
    const { block } = await create({ content: "처음" });
    const res = await PUT(req(`/blocks/${block.id}`, { method: "PUT", body: { content: "x" } }), params(block.id));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/memo/blocks/[id]", () => {
  it("deletes a block", async () => {
    const { block } = await create({ content: "지울 메모" });
    const res = await DELETE(req(`/blocks/${block.id}`, { method: "DELETE" }), params(block.id));
    expect(res.status).toBe(204);
    expect(await db.select().from(memoBlocks)).toHaveLength(0);
    expect((await DELETE(req(`/blocks/${block.id}`, { method: "DELETE" }), params(block.id))).status).toBe(404);
  });

  it("refuses to delete when ?baseVersion is stale (another device wrote in the meantime)", async () => {
    const { block } = await create({ content: "" });
    await PUT(req(`/blocks/${block.id}`, { method: "PUT", body: { content: "다른 기기에서 쓴 내용", baseVersion: 1 } }), params(block.id));
    const res = await DELETE(req(`/blocks/${block.id}?baseVersion=1`, { method: "DELETE" }), params(block.id));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { current: MemoBlock }).current.content).toBe("다른 기기에서 쓴 내용");
    expect(await db.select().from(memoBlocks)).toHaveLength(1);
  });
});

describe("GET /api/memo/event-keys", () => {
  it("lists the eventKeys that have a memo block", async () => {
    await create({ content: "일정 없는 메모" });
    await create({ eventRef: eventRef() });
    await create({ eventRef: eventRef({ eventKey: "primary:evt-2", calendarId: "primary", eventId: "evt-2", source: "personal" }) });
    const res = await GET_KEYS(req("/event-keys"));
    expect(res.status).toBe(200);
    const { keys } = (await res.json()) as { keys: string[] };
    expect([...keys].sort()).toEqual(["primary:evt-2", "work-cal:evt-1"]);
  });
});

// ---- folders and placement --------------------------------------------------------

async function folder(body: unknown): Promise<{ status: number; folder: MemoFolder }> {
  const res = await POST_FOLDER(req("/folders", { method: "POST", body }));
  return { status: res.status, folder: (await res.json()) as MemoFolder };
}

async function place(id: string, body: unknown): Promise<Response> {
  return PATCH(req(`/blocks/${id}`, { method: "PATCH", body }), params(id));
}

async function list(): Promise<{ blocks: MemoBlock[]; folders: MemoFolder[] }> {
  return (await (await GET_BLOCKS(req("/blocks"))).json()) as { blocks: MemoBlock[]; folders: MemoFolder[] };
}

const MISSING = "00000000-0000-4000-8000-000000000000";

describe("memo folders", () => {
  it("requires a session", async () => {
    expect((await POST_FOLDER(req("/folders", { method: "POST", body: { name: "회사" }, auth: false }))).status).toBe(401);
    expect((await PATCH_FOLDER(req(`/folders/${MISSING}`, { method: "PATCH", body: {}, auth: false }), params(MISSING))).status).toBe(401);
    expect((await DELETE_FOLDER(req(`/folders/${MISSING}`, { method: "DELETE", auth: false }), params(MISSING))).status).toBe(401);
    expect((await place(MISSING, {})).status).not.toBe(401);
  });

  it("creates folders with the first unused pencil and lists them with the blocks", async () => {
    const a = await folder({ name: "회사" });
    const b = await folder({ name: "개인" });
    expect(a.status).toBe(201);
    expect([a.folder.hue, b.folder.hue]).toEqual(["pink", "lilac"]);
    expect((await folder({ name: "모임", hue: "sky" })).folder.hue).toBe("sky");
    const { folders } = await list();
    expect(folders.map((f) => f.name)).toEqual(["회사", "개인", "모임"]);
  });

  it("trims folder names and refuses empty or over-40-character ones", async () => {
    expect((await folder({ name: "  회사 " })).folder.name).toBe("회사");
    expect((await folder({ name: "   " })).status).toBe(400);
    expect((await folder({ name: "가".repeat(41) })).status).toBe(400);
    expect((await folder({ name: "가".repeat(40) })).status).toBe(201);
    expect((await folder({ name: "회사", hue: "navy" })).status).toBe(400);
  });

  it("allows two folders with the same name", async () => {
    await folder({ name: "회사" });
    expect((await folder({ name: "회사" })).status).toBe(201);
  });

  it("renames and recolours a folder; 404 for one that doesn't exist", async () => {
    const { folder: f } = await folder({ name: "회사" });
    const res = await PATCH_FOLDER(req(`/folders/${f.id}`, { method: "PATCH", body: { name: " 일 ", hue: "green" } }), params(f.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "일", hue: "green" });
    expect((await PATCH_FOLDER(req(`/folders/${MISSING}`, { method: "PATCH", body: { name: "x" } }), params(MISSING))).status).toBe(404);
    expect((await PATCH_FOLDER(req("/folders/nope", { method: "PATCH", body: { name: "x" } }), params("nope"))).status).toBe(404);
  });

  it("creates a memo inside a folder, with a colour", async () => {
    const { folder: f } = await folder({ name: "회사" });
    const { status, block } = await create({ content: "주간 회의", folderId: f.id, hue: "aqua" });
    expect(status).toBe(201);
    expect(block).toMatchObject({ folderId: f.id, hue: "aqua" });
  });

  it("creates a memo outside any folder when its folder is gone (never refuses the text)", async () => {
    const gone = await create({ content: "지하철에서 쓴 글", folderId: MISSING });
    expect(gone.status).toBe(201);
    expect(gone.block).toMatchObject({ content: "지하철에서 쓴 글", folderId: null, hue: null });
    const odd = await create({ content: "이상한 값", folderId: "local-abc", hue: "navy" });
    expect(odd.status).toBe(201);
    expect(odd.block).toMatchObject({ folderId: null, hue: null });
  });

  it("moves a memo without touching its version or updatedAt, so a text save from another device still lands", async () => {
    const { folder: f } = await folder({ name: "회사" });
    const { block } = await create({ content: "주간 회의" });
    const res = await place(block.id, { folderId: f.id });
    expect(res.status).toBe(200);
    const moved = (await res.json()) as MemoBlock;
    expect(moved).toMatchObject({ folderId: f.id, version: block.version, updatedAt: block.updatedAt, content: "주간 회의" });

    const save = await PUT(req(`/blocks/${block.id}`, { method: "PUT", body: { content: "다른 기기", baseVersion: block.version } }), params(block.id));
    expect(save.status).toBe(200);
    expect(((await save.json()) as MemoBlock).folderId).toBe(f.id);
  });

  it("sets and clears a memo's own colour", async () => {
    const { block } = await create({ content: "장보기" });
    expect(((await (await place(block.id, { hue: "lemon" })).json()) as MemoBlock).hue).toBe("lemon");
    expect(((await (await place(block.id, { hue: null })).json()) as MemoBlock).hue).toBeNull();
    expect((await place(block.id, { hue: "navy" })).status).toBe(400);
  });

  it("refuses to move into a folder that doesn't exist; 404 for a memo that doesn't", async () => {
    const { block } = await create({ content: "장보기" });
    const res = await place(block.id, { folderId: MISSING });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toMatch(/폴더/);
    expect((await place(MISSING, { hue: "sky" })).status).toBe(404);
  });

  it("deleting a folder keeps every memo in it, moves them out, and keeps their colour", async () => {
    const { folder: f } = await folder({ name: "회사", hue: "tangerine" });
    const plain = (await create({ content: "주간 회의", folderId: f.id })).block;
    const own = (await create({ content: "1:1", folderId: f.id, hue: "sky" })).block;
    const res = await DELETE_FOLDER(req(`/folders/${f.id}`, { method: "DELETE" }), params(f.id));
    expect(res.status).toBe(204);

    const { blocks, folders } = await list();
    expect(folders).toHaveLength(0);
    const byId = new Map(blocks.map((b) => [b.id, b]));
    expect(byId.get(plain.id)).toMatchObject({ folderId: null, hue: "tangerine", version: plain.version, updatedAt: plain.updatedAt });
    expect(byId.get(own.id)).toMatchObject({ folderId: null, hue: "sky", version: own.version });
    expect((await DELETE_FOLDER(req(`/folders/${f.id}`, { method: "DELETE" }), params(f.id))).status).toBe(404);
  });
});
