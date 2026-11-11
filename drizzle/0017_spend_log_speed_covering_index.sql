-- Speed 页面按最多 7 天的小时桶读取 LiteLLM_SpendLogs，并对每条可测算请求计算 TPS
-- 平均值与 p50。原查询需要 startTime、endTime、completion_tokens、model、provider 等列，
-- 现有 startTime 索引不覆盖这些列，7 天窗口每次仍要读约 4 万个堆页（约 320 MB）。
--
-- 该索引让「有 deployment」的绝大多数行走 index-only scan；只有 model_id 为空、需要
-- metadata->>'resolved_model_group' 的少量行仍回表。生产环境需先在线执行
-- CREATE INDEX CONCURRENTLY（迁移事务不能执行 CONCURRENTLY），新库由本迁移直接建索引。
CREATE INDEX IF NOT EXISTS "idx_spend_logs_speed_covering"
ON "LiteLLM_SpendLogs" ("startTime")
INCLUDE ("endTime", "completion_tokens", "model", "model_id", "custom_llm_provider", "user");
