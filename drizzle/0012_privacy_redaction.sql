-- 可逆脱敏（privacy masking）观测表。
-- 只记录派生信息：请求级汇总与值级指纹（HMAC 片段 / 长度 / 前 3 个字符），不保存原文。
CREATE TABLE IF NOT EXISTS "LiteLLM_PrivacyRedactionEvents" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp (3) NOT NULL,
	"api_key" text DEFAULT '' NOT NULL,
	"user_id" text,
	"team_id" text,
	"client" text DEFAULT '' NOT NULL,
	"provider" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"kinds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurrences" integer DEFAULT 0 NOT NULL,
	"distinct_values" integer DEFAULT 0 NOT NULL,
	"action" text DEFAULT 'mask' NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"unresolved" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_events_created_idx" ON "LiteLLM_PrivacyRedactionEvents" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_events_client_idx" ON "LiteLLM_PrivacyRedactionEvents" ("client");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_events_provider_idx" ON "LiteLLM_PrivacyRedactionEvents" ("provider");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_events_request_idx" ON "LiteLLM_PrivacyRedactionEvents" ("request_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "LiteLLM_PrivacyRedactionValues" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp (3) NOT NULL,
	"kind" text NOT NULL,
	"value_hash" text NOT NULL,
	"value_length" integer DEFAULT 0 NOT NULL,
	"hint" text DEFAULT '' NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"client" text DEFAULT '' NOT NULL,
	"provider" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_values_created_idx" ON "LiteLLM_PrivacyRedactionValues" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_values_kind_idx" ON "LiteLLM_PrivacyRedactionValues" ("kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_values_hash_idx" ON "LiteLLM_PrivacyRedactionValues" ("value_hash", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_values_request_idx" ON "LiteLLM_PrivacyRedactionValues" ("request_id");
