CREATE TABLE "memo_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"hue" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memo_blocks" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "memo_blocks" ADD COLUMN "hue" text;--> statement-breakpoint
ALTER TABLE "memo_blocks" ADD CONSTRAINT "memo_blocks_folder_id_memo_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."memo_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Same as 0002: keep Supabase's REST API out of the new table.
ALTER TABLE "memo_folders" ENABLE ROW LEVEL SECURITY;
