-- 上游账号维度的原始指纹与关联：
-- SpendLogs 只增加一列实际 key 的 SHA-256；账号/凭据归属放在关联表，按 hash 追加，
-- token 轮换不会把同一账号拆成多行，账号删除后旧花费仍能归回 account_id。
ALTER TABLE "LiteLLM_SpendLogs"
	ADD COLUMN IF NOT EXISTS "upstream_key_hash" text;--> statement-breakpoint
COMMENT ON COLUMN "LiteLLM_SpendLogs"."upstream_key_hash" IS '实际上游 key 的 SHA-256；NULL 表示未记录；账号关系见 LiteLLM_UpstreamKeyAccount';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "LiteLLM_UpstreamKeyAccount" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"account_kind" text NOT NULL,
	"account_id" text NOT NULL,
	"provider" text NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "LiteLLM_UpstreamKeyAccount_kind_check"
		CHECK ("account_kind" IN ('subscription', 'credential'))
);--> statement-breakpoint
COMMENT ON TABLE "LiteLLM_UpstreamKeyAccount" IS '上游 key 指纹到订阅账号 / Credential 的追加式关联；不存 label 或密钥';--> statement-breakpoint
COMMENT ON COLUMN "LiteLLM_UpstreamKeyAccount"."account_id" IS '订阅账号 ID 或不可变的 Credential 名；账号删除后仍保留';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_upstream_key_account_identity"
	ON "LiteLLM_UpstreamKeyAccount" ("account_kind", "account_id");
