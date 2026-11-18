-- 上游模型元信息的持久弱缓存。
--
-- 目的：模型配置（LiteLLM_ProxyModelTable.model_info）只写人为关心的字段，费用、
-- 上下文长度这类上游本来就下发的信息靠人填既慢又容易过期。这里按来源缓存上游
-- `/models` 一类的元信息，配置缺失时作为兜底，并让 Dashboard 能展示「上游怎么说」。
--
-- 设计要点：
-- - 主键 (source, model_id)；`model_id = '*'` 是来源级状态行（列表拉取失败、该上游
--   不提供元信息接口等），保证「没取到」也有记录，不会每次请求都重试上游。
-- - status 三态：ok（拿到了）、unsupported（上游没有这个能力）、error（本次拉取失败）。
-- - expires_at 是弱过期：过期后仍可读旧值（stale-while-refresh），读取方从不等待上游。
--   ok/unsupported 默认 4 小时，error 更短，便于上游恢复后尽快自愈。
-- - metadata 是归一化后的字段（各上游字段名不同），raw 保留原始条目用于排查；
--   raw 写入前会剔除 Codex `base_instructions` 这类大段提示词。
CREATE TABLE IF NOT EXISTS "LiteLLM_UpstreamModelMeta" (
    "source" text NOT NULL,
    "model_id" text NOT NULL,
    "status" text NOT NULL,
    "display_name" text,
    "metadata" jsonb,
    "raw" jsonb,
    "error" text,
    "fetched_at" timestamp(3) with time zone NOT NULL DEFAULT now(),
    "expires_at" timestamp(3) with time zone NOT NULL,
    PRIMARY KEY ("source", "model_id")
);
--> statement-breakpoint
-- 定时清理只看过期时间，不需要按来源扫描全表。
CREATE INDEX IF NOT EXISTS "idx_upstream_model_meta_expires" ON "LiteLLM_UpstreamModelMeta" ("expires_at");
