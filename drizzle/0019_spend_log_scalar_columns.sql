-- SpendLogs 的 Usage 热路径标量投影。
--
-- 背景：浏览器本地时区的 Usage 不能直接复用按 UTC 日写入的 LiteLLM_Daily*Spend，
-- 必须在原始日志上按本地日聚合。原实现为 cache token 解压 metadata、为 endpoint
-- 解压平均 11 KB 的 proxy_server_request；同范围聚合实测约 1.5–2.75 s。
--
-- 这里只投影四个稳定、小体积的标量，metadata 与 proxy_server_request 仍然保留：
-- - cache_read_input_tokens / cache_creation_input_tokens：优先 additional_usage_values，
--   回退 usage_object，和日汇总表同源；
-- - resolved_model_group：metadata 的最终模型组，缺失时回退 model_group；
-- - endpoint：proxy_server_request.url 去掉 query，和日汇总的 endpoint 同源。
--
-- 列先在迁移里回填，避免新代码上线到回填完成之间出现 cache/endpoint 为零的窗口。
-- 回填只更新标量列，不读取或重写 messages / response / proxy 的任何正文。
ALTER TABLE "LiteLLM_SpendLogs" ADD COLUMN IF NOT EXISTS "cache_read_input_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "LiteLLM_SpendLogs" ADD COLUMN IF NOT EXISTS "cache_creation_input_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "LiteLLM_SpendLogs" ADD COLUMN IF NOT EXISTS "resolved_model_group" text;--> statement-breakpoint
ALTER TABLE "LiteLLM_SpendLogs" ADD COLUMN IF NOT EXISTS "endpoint" text;--> statement-breakpoint
UPDATE "LiteLLM_SpendLogs"
SET
	"cache_read_input_tokens" = COALESCE(
		CASE
			WHEN (metadata -> 'additional_usage_values' ->> 'cache_read_input_tokens') ~ '^[0-9]+$'
				THEN (metadata -> 'additional_usage_values' ->> 'cache_read_input_tokens')::bigint
		END,
		CASE
			WHEN (metadata -> 'usage_object' ->> 'cache_read_input_tokens') ~ '^[0-9]+$'
				THEN (metadata -> 'usage_object' ->> 'cache_read_input_tokens')::bigint
		END,
		0
	),
	"cache_creation_input_tokens" = COALESCE(
		CASE
			WHEN (metadata -> 'additional_usage_values' ->> 'cache_creation_input_tokens') ~ '^[0-9]+$'
				THEN (metadata -> 'additional_usage_values' ->> 'cache_creation_input_tokens')::bigint
		END,
		CASE
			WHEN (metadata -> 'usage_object' ->> 'cache_creation_input_tokens') ~ '^[0-9]+$'
				THEN (metadata -> 'usage_object' ->> 'cache_creation_input_tokens')::bigint
		END,
		0
	),
	"resolved_model_group" = COALESCE(
		NULLIF(metadata ->> 'resolved_model_group', ''),
		NULLIF(model_group, '')
	),
	"endpoint" = COALESCE(split_part(proxy_server_request ->> 'url', '?', 1), '');
