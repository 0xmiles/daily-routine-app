import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json } from "@/shared/http";
import { listSharedCalendars } from "@/features/calendar/server/connections";
import { calendarErrorResponse } from "@/features/calendar/server/events";

// GET /api/settings/connections/shared-calendars → { calendars: SharedCalendar[] }
// 409 "개인 캘린더를 먼저 연결해 주세요." when no personal calendar is connected.
export const GET = withUser(async () => {
  try {
    return json({ calendars: await listSharedCalendars(getDb()) });
  } catch (error) {
    return calendarErrorResponse(error);
  }
});
