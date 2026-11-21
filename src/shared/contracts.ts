// Shared types between browser and server. Copied verbatim from the plan (Task 0.2).
// Do not change shapes here without coordinating with every track.

import type { Hue } from '@/ui/hues';

export type Scope = 'work' | 'personal';
export type CalendarSource = 'personal' | 'work' | 'holiday';
export interface CalendarEvent {
  id: string; calendarId: string; source: CalendarSource;
  title: string | null;        // 바쁨만 보이면 null
  busyOnly: boolean;
  start: string; end: string;  // allDay면 'YYYY-MM-DD', 아니면 ISO(+09:00)
  allDay: boolean; location: string | null; attendeeCount: number | null;
  recurringEventId: string | null;
  readOnly: boolean;           // work, holiday는 true
}
export type WorkCalendarStatus = 'connected' | 'busy_only' | 'disconnected' | 'error';
export interface EventsResponse { events: CalendarEvent[]; workStatus: WorkCalendarStatus; personalConnected: boolean }
export interface NewPersonalEvent { title: string; start: string; end: string; allDay: boolean; description?: string }
export type Recurrence = { freq: 'daily' } | { freq: 'weekly'; weekdays: number[] } | { freq: 'monthly'; day: number }; // weekdays: 0=일
export interface Todo {
  id: string; title: string; scope: Scope;
  dueDate: string | null; dueTime: string | null;  // 'YYYY-MM-DD', 'HH:MM' (서울)
  doneAt: string | null; recurrence: Recurrence | null; seriesId: string | null;
  notify: { enabled: boolean; offsetMin: number | null };   // null = 기본값(30분 전 / 날짜만이면 09:00)
}
export interface EventRef {
  eventKey: string;  // `${calendarId}:${eventId}`
  calendarId: string; eventId: string; recurringEventId: string | null;
  source: 'personal' | 'work'; title: string; start: string; end: string; allDay: boolean; deleted: boolean;
}
export interface MemoBlock {
  id: string; content: string; createdAt: string; updatedAt: string; version: number; eventRef: EventRef | null;
  folderId: string | null;  // null = 폴더 밖
  hue: Hue | null;          // null = 자동(폴더 색, 폴더 밖이면 메모마다 정해진 색)
}
export interface MemoFolder { id: string; name: string; hue: Hue; createdAt: string; updatedAt: string }
export type AccountKind = 'checking' | 'savings' | 'investment';
export interface BankAccount {
  id: string; kind: AccountKind; name: string; numberMasked: string | null;
  balance: number | null; asOf: string | null; stale: boolean;
  manualValuation: { amount: number; enteredAt: string } | null;
}
export interface Txn { id: string; accountId: string; occurredAt: string; description: string; withdrawal: number; deposit: number; balanceAfter: number; isTransfer: boolean }
export interface MonthFlow { month: string; deposit: number; withdrawal: number; transfer: number }
export interface AssetsSummary { accounts: BankAccount[]; total: number; flow: MonthFlow }
export const APP_TZ = 'Asia/Seoul';
