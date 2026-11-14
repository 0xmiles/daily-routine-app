import { listEventKeys } from "@/features/memo/server/repo";
import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json } from "@/shared/http";

/** GET /api/memo/event-keys → { keys: string[] } — eventKeys that already have a memo block. */
export const GET = withUser(async () => {
  return json({ keys: await listEventKeys(getDb()) });
});
