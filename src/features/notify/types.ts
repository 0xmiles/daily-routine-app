// Shared by the reminders API and the settings screen.

export interface ReminderSettings {
  /** Weekly 신한 upload reminder: weekday 0=Sun … 6=Sat and 'HH:MM', Seoul. */
  uploadReminderDow: number;
  uploadReminderTime: string;
  /** Todo with a due time: notify this many minutes before. */
  defaultOffsetMin: number;
  /** Todo with only a due date: notify at this time that day. */
  dateOnlyNotifyTime: string;
}

export type ReminderSettingsPatch = Partial<ReminderSettings>;

/** Body of POST /api/push/subscribe — `PushSubscription.toJSON()`. */
export interface PushSubscriptionBody {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}
