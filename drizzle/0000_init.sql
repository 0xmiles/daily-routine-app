CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"number_masked" text,
	"number_digits" text,
	"as_of" date,
	"manual_amount" bigint,
	"manual_entered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_number_digits_unique" UNIQUE("number_digits")
);
--> statement-breakpoint
CREATE TABLE "google_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text NOT NULL,
	"email" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"expires_at" timestamp with time zone NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_accounts_role_unique" UNIQUE("role")
);
--> statement-breakpoint
CREATE TABLE "memo_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"event_key" text,
	"event_ref" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memo_blocks_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"todo_id" uuid,
	"fire_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"work_calendar_via" text DEFAULT 'none' NOT NULL,
	"work_calendar_id" text,
	"default_offset_min" integer DEFAULT 30 NOT NULL,
	"date_only_notify_time" text DEFAULT '09:00' NOT NULL,
	"upload_reminder_dow" integer DEFAULT 0 NOT NULL,
	"upload_reminder_time" text DEFAULT '20:00' NOT NULL,
	"last_upload_reminder_sent_at" timestamp with time zone,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "todos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"scope" text DEFAULT 'personal' NOT NULL,
	"due_date" date,
	"due_time" text,
	"done_at" timestamp with time zone,
	"recurrence" jsonb,
	"series_id" uuid,
	"notify_enabled" boolean DEFAULT true NOT NULL,
	"notify_offset_min" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"withdrawal" bigint DEFAULT 0 NOT NULL,
	"deposit" bigint DEFAULT 0 NOT NULL,
	"balance_after" bigint NOT NULL,
	"is_transfer" boolean DEFAULT false NOT NULL,
	"transfer_overridden" boolean DEFAULT false NOT NULL,
	"dedupe_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"period_start" date,
	"period_end" date,
	"row_count" integer NOT NULL,
	"inserted_count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_todo_id_todos_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_bank_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_account_id_bank_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_fire_at_idx" ON "notifications" USING btree ("fire_at");--> statement-breakpoint
CREATE INDEX "notifications_todo_id_idx" ON "notifications" USING btree ("todo_id");--> statement-breakpoint
CREATE INDEX "todos_due_date_idx" ON "todos" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "todos_series_id_idx" ON "todos" USING btree ("series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_account_dedupe_uq" ON "transactions" USING btree ("account_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "transactions_account_occurred_idx" ON "transactions" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "uploads_account_id_idx" ON "uploads" USING btree ("account_id");