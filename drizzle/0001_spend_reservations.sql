CREATE TABLE IF NOT EXISTS "LiteLLM_SpendReservations" (
	"request_id" text PRIMARY KEY NOT NULL,
	"scope_ids" jsonb NOT NULL,
	"reserved" double precision NOT NULL,
	"actual" double precision,
	"status" text NOT NULL,
	"expires_at" timestamp DEFAULT now() + interval '15 minutes' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spend_reservations_status_idx" ON "LiteLLM_SpendReservations" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spend_reservations_scope_ids_gin_idx" ON "LiteLLM_SpendReservations" USING gin ("scope_ids");
