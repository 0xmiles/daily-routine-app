-- Supabase publishes the public schema through its REST API (anon/publishable key).
-- RLS on with no policies blocks that API completely. The app connects as the
-- table owner, which RLS does not restrict, so the app itself is unaffected.
ALTER TABLE "bank_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "google_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memo_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "todos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "uploads" ENABLE ROW LEVEL SECURITY;
