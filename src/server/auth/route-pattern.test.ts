// Living template for API route tests in every track.
// Real tests import the handlers from the route file instead, e.g.
//   import { GET, POST } from "@/app/api/todos/route";
//   import { PATCH } from "@/app/api/todos/[id]/route";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, type Db } from "@/server/db/client";
import { todos } from "@/server/db/schema";
import { createTestDb } from "@/server/db/test-db";
import { json, problem } from "@/shared/http";
import { sessionCookieFor, withUser } from "./session";

// --- what a route file looks like --------------------------------------------
const GET = withUser(async () => {
  const rows = await getDb().select().from(todos);
  return json({ count: rows.length });
});

// In a route file, type ctx as `RouteContext<'/api/todos/[id]'>`.
const DELETE = withUser(async (_req, _user, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const deleted = await getDb().delete(todos).where(eq(todos.id, id)).returning();
  return deleted.length ? new Response(null, { status: 204 }) : problem(404, "할 일을 찾지 못했어요.");
});

// --- the test pattern ----------------------------------------------------------
describe("route handler test pattern", () => {
  let db: Db;
  let cookie: string;

  beforeEach(async () => {
    db = await createTestDb(); // fresh in-memory DB; getDb() now returns it
    cookie = await sessionCookieFor(); // session for TEST_ENV.ALLOWED_EMAIL
  });

  it("401 without a cookie", async () => {
    const res = await GET(new Request("http://localhost/api/todos"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: "로그인이 필요해요." });
  });

  it("reads through getDb() with a session cookie", async () => {
    await db.insert(todos).values([{ title: "a" }, { title: "b" }]);
    const res = await GET(new Request("http://localhost/api/todos", { headers: { cookie } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 2 });
  });

  it("dynamic route: pass the context with params as a Promise", async () => {
    const [todo] = await db.insert(todos).values({ title: "x" }).returning();
    const req = new Request(`http://localhost/api/todos/${todo.id}`, { method: "DELETE", headers: { cookie } });
    expect((await DELETE(req, { params: Promise.resolve({ id: todo.id }) })).status).toBe(204);
    expect(await db.select().from(todos)).toHaveLength(0);
  });
});
