-- 在途请求的观测字段：随请求推进逐步补齐的一次性信息。
-- 这些列在对应阶段确定后不再变化，日志详情页据此在请求结束前展示实际路由与上游信息。
ALTER TABLE "LiteLLM_ActiveRequests"
ADD COLUMN IF NOT EXISTS "custom_llm_provider" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "LiteLLM_ActiveRequests"
ADD COLUMN IF NOT EXISTS "api_base" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "LiteLLM_ActiveRequests"
ADD COLUMN IF NOT EXISTS "completion_start_time" timestamp(3);
