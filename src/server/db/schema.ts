import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AccountKind, EventRef, Recurrence, Scope } from "@/shared/contracts";

// Owned by Phase 0. Other tracks: do not edit — report needed changes instead.
// After editing, run `npm run db:generate` to add a migration under drizzle/.
//
// Conventions:
// - ids are uuid (defaultRandom), except `settings.id` which is always 1.
// - timestamps are timestamptz returned as JS Date (`mode: 'date'`).
// - calendar dates are Postgres `date` returned as 'YYYY-MM-DD' strings.
// - times of day are text 'HH:MM' (Seoul wall clock).
// - money is whole won in bigint, returned as JS number.

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const won = (name: string) => bigint(name, { mode: "number" });

export const googleAccounts = pgTable("google_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  role: text("role", { enum: ["personal", "work"] }).notNull().unique(),
  email: text("email").notNull(),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc"),
  expiresAt: timestamptz("expires_at").notNull(),
  scope: text("scope").notNull().default(""),
  status: text("status", { enum: ["ok", "needs_reconnect"] }).notNull().default("ok"),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

export const settings = pgTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),
    // 회사 캘린더
    workCalendarVia: text("work_calendar_via", { enum: ["work_account", "personal_shared", "none"] })
      .notNull()
      .default("none"),
    workCalendarId: text("work_calendar_id"),
    // 할 일 알림 기본값
    defaultOffsetMin: integer("default_offset_min").notNull().default(30),
    dateOnlyNotifyTime: text("date_only_notify_time").notNull().default("09:00"),
    // 거래내역 업로드 알림 (요일 0=일, 서울 시각)
    uploadReminderDow: integer("upload_reminder_dow").notNull().default(0),
    uploadReminderTime: text("upload_reminder_time").notNull().default("20:00"),
    lastUploadReminderSentAt: timestamptz("last_upload_reminder_sent_at"),
  },
  (t) => [check("settings_single_row", sql`${t.id} = 1`)],
);

export const todos = pgTable(
  "todos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    scope: text("scope", { enum: ["work", "personal"] }).$type<Scope>().notNull().default("personal"),
    dueDate: date("due_date", { mode: "string" }),
    dueTime: text("due_time"),
    doneAt: timestamptz("done_at"),
    recurrence: jsonb("recurrence").$type<Recurrence>(),
    seriesId: uuid("series_id"),
    notifyEnabled: boolean("notify_enabled").notNull().default(true),
    notifyOffsetMin: integer("notify_offset_min"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("todos_due_date_idx").on(t.dueDate), index("todos_series_id_idx").on(t.seriesId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["todo_due", "upload_reminder"] }).notNull(),
    todoId: uuid("todo_id").references(() => todos.id, { onDelete: "cascade" }),
    fireAt: timestamptz("fire_at").notNull(),
    sentAt: timestamptz("sent_at"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    url: text("url").notNull(),
  },
  (t) => [index("notifications_fire_at_idx").on(t.fireAt), index("notifications_todo_id_idx").on(t.todoId)],
);

export const memoBlocks = pgTable("memo_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  content: text("content").notNull().default(""),
  eventKey: text("event_key").unique(),
  eventRef: jsonb("event_ref").$type<EventRef>(),
  version: integer("version").notNull().default(1),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

export const bankAccounts = pgTable("bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind", { enum: ["checking", "savings", "investment"] }).$type<AccountKind>().notNull(),
  name: text("name").notNull(),
  numberMasked: text("number_masked"),
  numberDigits: text("number_digits").unique(),
  asOf: date("as_of", { mode: "string" }),
  manualAmount: won("manual_amount"),
  manualEnteredAt: timestamptz("manual_entered_at"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => bankAccounts.id, { onDelete: "cascade" }),
    occurredAt: timestamptz("occurred_at").notNull(),
    description: text("description").notNull(),
    withdrawal: won("withdrawal").notNull().default(0),
    deposit: won("deposit").notNull().default(0),
    balanceAfter: won("balance_after").notNull(),
    isTransfer: boolean("is_transfer").notNull().default(false),
    transferOverridden: boolean("transfer_overridden").notNull().default(false),
    dedupeKey: text("dedupe_key").notNull(),
  },
  (t) => [
    uniqueIndex("transactions_account_dedupe_uq").on(t.accountId, t.dedupeKey),
    index("transactions_account_occurred_idx").on(t.accountId, t.occurredAt),
  ],
);

export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => bankAccounts.id, { onDelete: "cascade" }),
    uploadedAt: timestamptz("uploaded_at").notNull().defaultNow(),
    periodStart: date("period_start", { mode: "string" }),
    periodEnd: date("period_end", { mode: "string" }),
    rowCount: integer("row_count").notNull(),
    insertedCount: integer("inserted_count").notNull(),
  },
  (t) => [index("uploads_account_id_idx").on(t.accountId)],
);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

// Row types (select) and insert types, for repos in each track.
export type GoogleAccountRow = typeof googleAccounts.$inferSelect;
export type NewGoogleAccountRow = typeof googleAccounts.$inferInsert;
export type SettingsRow = typeof settings.$inferSelect;
export type TodoRow = typeof todos.$inferSelect;
export type NewTodoRow = typeof todos.$inferInsert;
export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;
export type MemoBlockRow = typeof memoBlocks.$inferSelect;
export type NewMemoBlockRow = typeof memoBlocks.$inferInsert;
export type BankAccountRow = typeof bankAccounts.$inferSelect;
export type NewBankAccountRow = typeof bankAccounts.$inferInsert;
export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransactionRow = typeof transactions.$inferInsert;
export type UploadRow = typeof uploads.$inferSelect;
export type NewUploadRow = typeof uploads.$inferInsert;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscriptionRow = typeof pushSubscriptions.$inferInsert;
