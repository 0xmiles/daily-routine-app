import { addDays, seoulParts } from "@/shared/time";

const pad2 = (n: number) => String(n).padStart(2, "0");

export interface TimeSlot {
  /** ISO with +09:00, e.g. '2026-11-14T15:00:00+09:00'. */
  start: string;
  end: string;
  /** Seoul date of `start`. */
  date: string;
  /** 'HH:MM' (Seoul) of start and end. */
  startTime: string;
  endTime: string;
}

/** Seoul wall clock → ISO string with the fixed +09:00 offset. */
export function seoulIso(date: string, time: string): string {
  return `${date}T${time}:00+09:00`;
}

/**
 * Quick-add default for a new event: from the next full hour (Seoul) for one
 * hour. 14:20 → 15:00–16:00; 23:10 → tomorrow 00:00–01:00.
 */
export function nextFullHourSlot(now: Date = new Date()): TimeSlot {
  const { date, time } = seoulParts(now);
  let startDate = date;
  let startHour = Number(time.slice(0, 2)) + 1;
  if (startHour === 24) {
    startDate = addDays(date, 1);
    startHour = 0;
  }
  let endDate = startDate;
  let endHour = startHour + 1;
  if (endHour === 24) {
    endDate = addDays(startDate, 1);
    endHour = 0;
  }
  const startTime = `${pad2(startHour)}:00`;
  const endTime = `${pad2(endHour)}:00`;
  return {
    start: seoulIso(startDate, startTime),
    end: seoulIso(endDate, endTime),
    date: startDate,
    startTime,
    endTime,
  };
}
