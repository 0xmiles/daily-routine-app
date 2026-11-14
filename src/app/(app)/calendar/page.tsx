import type { Metadata } from "next";
import { CalendarPage } from "@/features/calendar/CalendarPage";
import { isDateString } from "@/features/today/eventUtils";
import { seoulToday } from "@/shared/time";

export const metadata: Metadata = { title: "달력" };

export default async function Page({ searchParams }: PageProps<"/calendar">) {
  const { date: raw } = await searchParams;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const today = seoulToday();
  const date = isDateString(value) ? value : today;
  return <CalendarPage key={date} initialDate={date} today={today} />;
}
