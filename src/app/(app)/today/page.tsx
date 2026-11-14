import type { Metadata } from "next";
import { TodayPage } from "@/features/today/TodayPage";
import { isDateString } from "@/features/today/eventUtils";
import { seoulToday } from "@/shared/time";

export const metadata: Metadata = { title: "오늘" };

export default async function Page({ searchParams }: PageProps<"/today">) {
  const { date: raw } = await searchParams;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const today = seoulToday();
  const date = isDateString(value) ? value : today;
  return <TodayPage key={date} initialDate={date} today={today} />;
}
