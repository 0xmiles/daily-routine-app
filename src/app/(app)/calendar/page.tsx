import type { Metadata } from "next";
import { CalendarPage } from "@/features/calendar/CalendarPage";
import { isCalendarView } from "@/features/calendar/views";
import { isDateString } from "@/features/today/eventUtils";
import { seoulToday } from "@/shared/time";

export const metadata: Metadata = { title: "달력" };

export default async function Page({ searchParams }: PageProps<"/calendar">) {
  const { date: rawDate, view: rawView } = await searchParams;
  const value = Array.isArray(rawDate) ? rawDate[0] : rawDate;
  const viewValue = Array.isArray(rawView) ? rawView[0] : rawView;
  const today = seoulToday();
  const date = isDateString(value) ? value : today;
  const view = isCalendarView(viewValue) ? viewValue : undefined;
  return <CalendarPage key={`${date}:${view ?? ""}`} initialDate={date} today={today} initialView={view} />;
}
