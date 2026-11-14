import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json } from "@/shared/http";
import { calendarErrorResponse, deletePersonalEvent, updatePersonalEvent } from "@/features/calendar/server/events";

// PATCH|DELETE /api/calendar/events/[id] — only events in the personal `primary`
// calendar. `id` is a Google event id or the eventKey `primary:<id>`. A
// `calendarId` (query or body) other than 'primary' is refused with 403.

export const PATCH = withUser(async (req, _user, ctx: RouteContext<"/api/calendar/events/[id]">) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const hint = new URL(req.url).searchParams.get("calendarId") ?? undefined;
  try {
    return json(await updatePersonalEvent(getDb(), id, hint, body));
  } catch (error) {
    return calendarErrorResponse(error);
  }
});

export const DELETE = withUser(async (req, _user, ctx: RouteContext<"/api/calendar/events/[id]">) => {
  const { id } = await ctx.params;
  const hint = new URL(req.url).searchParams.get("calendarId") ?? undefined;
  try {
    await deletePersonalEvent(getDb(), id, hint);
    return new Response(null, { status: 204 });
  } catch (error) {
    return calendarErrorResponse(error);
  }
});
