-- Speed 查询把没有 deployment（model_id 为空）的 fallback 行拆出来单独扫描，
-- 以避免为全部行解压 metadata。这类行只占约 1%，但如果没有独立索引，PostgreSQL
-- 仍会为这个分支扫描整个时间窗口的堆表，反而放大总读取量。
CREATE INDEX IF NOT EXISTS "idx_spend_logs_speed_fallback"
ON "LiteLLM_SpendLogs" ("startTime")
WHERE COALESCE(model_id, '') = '';
