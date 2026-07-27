CREATE TABLE IF NOT EXISTS "LiteLLM_ActiveRequests" (
	"request_id" text PRIMARY KEY NOT NULL,
	"call_type" text NOT NULL,
	"api_key" text DEFAULT '' NOT NULL,
	"startTime" timestamp(3) NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"model_id" text DEFAULT '',
	"model_group" text DEFAULT '',
	"user" text DEFAULT '',
	"team_id" text,
	"organization_id" text,
	"end_user" text,
	"requester_ip_address" text,
	"session_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"request_duration_ms" integer,
	"expires_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "active_requests_status_start_idx" ON "LiteLLM_ActiveRequests" USING btree ("status", "startTime");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "active_requests_team_idx" ON "LiteLLM_ActiveRequests" USING btree ("team_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "active_requests_user_idx" ON "LiteLLM_ActiveRequests" USING btree ("user");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "active_requests_api_key_idx" ON "LiteLLM_ActiveRequests" USING btree ("api_key");
