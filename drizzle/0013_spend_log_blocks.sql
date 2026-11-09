-- SpendLog 内容寻址块存储。
-- 同一段消息在一次请求里会出现三份（messages / proxy_server_request.body.messages /
-- upstream_request.body.messages），跨轮次又整段重复；这里按消息内容寻址只存一份，
-- SpendLogs 的 jsonb 里改存引用 id 列表，读取时由 repository 层组装。
-- 表只增不删：块被多个请求共享，按时间清理会打破仍引用它的行。
CREATE TABLE IF NOT EXISTS "LiteLLM_SpendLogBlocks" (
	"block_id" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"byte_size" integer NOT NULL,
	"first_seen" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "LiteLLM_SpendLogBlocks_first_seen_idx" ON "LiteLLM_SpendLogBlocks" ("first_seen");
