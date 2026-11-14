import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json } from "@/shared/http";
import { getConnections, setWorkCalendar } from "@/features/calendar/server/connections";
import { calendarErrorResponse } from "@/features/calendar/server/events";

// GET /api/settings/connections → ConnectionsResponse (see features/calendar/client.ts)
export const GET = withUser(async () => {
  try {
    return json(await getConnections(getDb()));
  } catch (error) {
    return calendarErrorResponse(error);
  }
});

// PUT /api/settings/connections  { via:'personal_shared', calendarId } | { via:'none' } → ConnectionsResponse
export const PUT = withUser(async (req) => {
  const body = await req.json().catch(() => null);
  try {
    return json(await setWorkCalendar(getDb(), body));
  } catch (error) {
    return calendarErrorResponse(error);
  }
});
