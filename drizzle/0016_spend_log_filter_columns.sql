-- SpendLog 表头过滤用的冗余列。
--
-- 背景：Logs 列表的 Key Alias / Error Code 过滤原先直接读 `metadata`。metadata 平均 3 KB
-- 且存放在 TOAST，过滤要为窗口内每一行解压整份 JSON，冷缓存下 24 小时窗口的 count 要
-- 9–40 s、分页要 38–58 s。这两列只保存过滤需要的那两个标量，让过滤退化为小列扫描。
--
-- 列可空：历史行由 scripts/backfill-spend-log-filter-columns.cjs 分批回填，回填完成前
-- 读侧仍然走 metadata（先写后读两次发布），因此不存在「老数据查不到」的中间态。
ALTER TABLE "LiteLLM_SpendLogs" ADD COLUMN IF NOT EXISTS "key_alias" text;--> statement-breakpoint
ALTER TABLE "LiteLLM_SpendLogs" ADD COLUMN IF NOT EXISTS "error_code" text;--> statement-breakpoint
-- Error Code 是等值过滤，索引可直接定位；key_alias 保持 LIKE '%x%' 语义，btree 无法使用，
-- 因此这里只为 error_code 建索引，避免为不生效的索引付出写入与 VACUUM 成本。
CREATE INDEX IF NOT EXISTS "idx_spend_logs_error_code_time" ON "LiteLLM_SpendLogs" ("error_code", "startTime");
