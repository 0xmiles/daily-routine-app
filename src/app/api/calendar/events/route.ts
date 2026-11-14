import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json, problem } from "@/shared/http";
import {
  calendarErrorResponse,
  createPersonalEvent,
  listEvents,
  validateRange,
} from "@/features/calendar/server/events";

// GET /api/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD[&fresh=1] (to inclusive) → EventsResponse
export const GET = withUser(async (req) => {
  const params = new URL(req.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const invalid = validateRange(from, to);
  if (invalid) return problem(400, invalid);
  try {
    return json(await listEvents(getDb(), from!, to!, { fresh: params.get("fresh") === "1" }));
  } catch (error) {
    return calendarErrorResponse(error);
  }
});

// POST /api/calendar/events  body NewPersonalEvent → 201 CalendarEvent (personal primary only)
export const POST = withUser(async (req) => {
  const body = await req.json().catch(() => null);
  try {
    return json(await createPersonalEvent(getDb(), body), 201);
  } catch (error) {
    return calendarErrorResponse(error);
  }
});
