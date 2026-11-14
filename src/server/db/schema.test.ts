import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "./client";
import { memoBlocks, notifications, settings, todos, transactions, bankAccounts } from "./schema";
import { createTestDb } from "./test-db";

describe("db", () => {
  it("createTestDb applies migrations and seeds settings", async () => {
    const db = await createTestDb();
    const rows = await db.select().from(settings);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 1,
      workCalendarVia: "none",
      workCalendarId: null,
      defaultOffsetMin: 30,
      dateOnlyNotifyTime: "09:00",
      uploadReminderDow: 0,
      uploadReminderTime: "20:00",
      lastUploadReminderSentAt: null,
    });
  });

  it("every public table has row-level security on (blocks Supabase's REST API)", async () => {
    const db = await createTestDb();
    const result = await db.execute(
      sql`select c.relname as name, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`,
    );
    const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { name: string; rls: boolean }[];
    expect(rows.length).toBeGreaterThanOrEqual(9);
    expect(rows.filter((r) => !r.rls).map((r) => r.name)).toEqual([]);
  });

  it("createTestDb registers the db so getDb() returns it", async () => {
    const db = await createTestDb();
    expect(getDb()).toBe(db);
  });

  it("each createTestDb is isolated", async () => {
    const a = await createTestDb();
    await a.insert(todos).values({ title: "a" });
    expect(await a.select().from(todos)).toHaveLength(1);
    const b = await createTestDb();
    expect(await b.select().from(todos)).toHaveLength(0);
    expect(await b.select().from(settings)).toHaveLength(1);
  });

  it("todo defaults, uuid ids and timestamptz round-trip", async () => {
    const db = await createTestDb();
    const [row] = await db
      .insert(todos)
      .values({ title: "보고서 제출", dueDate: "2026-11-14", recurrence: { freq: "weekly", weekdays: [6] } })
      .returning();
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.scope).toBe("personal");
    expect(row.notifyEnabled).toBe(true);
    expect(row.notifyOffsetMin).toBeNull();
    expect(row.dueDate).toBe("2026-11-14");
    expect(row.recurrence).toEqual({ freq: "weekly", weekdays: [6] });
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("deleting a todo cascades to its notifications", async () => {
    const db = await createTestDb();
    const [todo] = await db.insert(todos).values({ title: "x" }).returning();
    await db.insert(notifications).values({
      kind: "todo_due",
      todoId: todo.id,
      fireAt: new Date("2026-11-16T08:30:00Z"),
      title: "x",
      body: "18:00까지",
      url: "/today",
    });
    await db.delete(todos).where(eq(todos.id, todo.id));
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it("memo eventKey is unique and version defaults to 1", async () => {
    const db = await createTestDb();
    const [block] = await db.insert(memoBlocks).values({ eventKey: "primary:e1" }).returning();
    expect(block.version).toBe(1);
    expect(block.content).toBe("");
    await expect(db.insert(memoBlocks).values({ eventKey: "primary:e1" })).rejects.toThrow();
    // NULL eventKeys are not unique-constrained.
    await db.insert(memoBlocks).values([{}, {}]);
  });

  it("transactions are unique per (accountId, dedupeKey) and amounts beyond int32 survive", async () => {
    const db = await createTestDb();
    const [account] = await db.insert(bankAccounts).values({ kind: "investment", name: "투자" }).returning();
    const row = {
      accountId: account.id,
      occurredAt: new Date("2026-11-14T00:12:00Z"),
      description: "커피",
      withdrawal: 4500,
      deposit: 0,
      balanceAfter: 3_000_000_000,
      dedupeKey: "k1",
    };
    await db.insert(transactions).values(row);
    await expect(db.insert(transactions).values(row)).rejects.toThrow();
    const [saved] = await db.select().from(transactions);
    expect(saved.balanceAfter).toBe(3_000_000_000);
    expect(saved.isTransfer).toBe(false);
  });
});
