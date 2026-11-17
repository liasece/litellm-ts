-- 清理没有读取入口的遗留数据库对象。
--
-- 保留依据（2026-11-17 只读审计）：
-- - 8 个 Python 时代视图在 TS 代码、Dashboard、文档和脚本中均无读取方；全局/每日
--   聚合已经直接查询 LiteLLM_SpendLogs 与 LiteLLM_Daily* 表。
-- - LiteLLM_AgentsTable 只在 SpendTracker 里累加 spend，没有任何定义/列表/详情读取；
--   /v1/agents 与 MCP 管理面在 0011 清理中已移除，agent 每日汇总仍由
--   LiteLLM_DailyAgentSpend 提供。
-- - _prisma_migrations 是 Python 迁移历史，TS 运行时只使用 __drizzle_migrations。
-- - litellm_credential_e2e 是旧测试 schema，59 张表全部为空；drizzle schema 只有
--   一张空的 __drizzle_migrations，均不在当前 search_path。
-- - LiteLLM_SpendLogBlocks.first_seen 只有写入默认值和索引，没有任何读取方；
--   块共享生命周期由引用关系决定，不能按该时间清理，因此连列和索引一起移除。
--
-- 注意：本迁移只删除结构和小体积历史元数据；SpendLogs 中历史认证头与
-- __litellm_responses_body 的物理清理使用 scripts/cleanup-spend-log-sensitive-data.cjs，
-- 批处理执行，避免在启动迁移中长时间持有大 JSONB 行。

--> statement-breakpoint
DROP VIEW IF EXISTS "MonthlyGlobalSpendPerUserPerKey" CASCADE;
--> statement-breakpoint
DROP VIEW IF EXISTS "MonthlyGlobalSpendPerKey" CASCADE;
--> statement-breakpoint
DROP VIEW IF EXISTS "MonthlyGlobalSpend" CASCADE;
--> statement-breakpoint
DROP VIEW IF EXISTS "LiteLLM_VerificationTokenView" CASCADE;
--> statement-breakpoint
DROP VIEW IF EXISTS "Last30dTopEndUsersSpend" CASCADE;
--> statement-breakpoint
DROP VIEW IF EXISTS "Last30dModelsBySpend" CASCADE;
--> statement-breakpoint
DROP VIEW IF EXISTS "Last30dKeysBySpend" CASCADE;
--> statement-breakpoint
DROP VIEW IF EXISTS "DailyTagSpend" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "LiteLLM_AgentsTable" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "public"."_prisma_migrations";
--> statement-breakpoint
DROP SCHEMA IF EXISTS "litellm_credential_e2e" CASCADE;
--> statement-breakpoint
DROP SCHEMA IF EXISTS "drizzle" CASCADE;
--> statement-breakpoint
DROP INDEX IF EXISTS "LiteLLM_SpendLogBlocks_first_seen_idx";
--> statement-breakpoint
ALTER TABLE "LiteLLM_SpendLogBlocks" DROP COLUMN IF EXISTS "first_seen";
