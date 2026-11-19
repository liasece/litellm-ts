-- 订阅账号改为数据库持久化。
--
-- 目的：账号原本以 auth JSON 文件为唯一持久化格式，「有效 / 已回收」靠文件在 auths
-- 目录还是 .trash 目录表达。目录语义带来三类问题：回收站文件名要加时间戳前缀再解析、
-- 同名文件恢复会互相覆盖、托管账号投影会重新写出已被回收的文件（把已撤销的 key 复活）。
--
-- 设计要点：
-- - 一行一个账号，`payload` 保存旧 auth JSON 原文，token 与未知字段无损保留。
-- - `trashed_at` 是唯一有效性字段：为空参与调度，非空即回收站；恢复就是清空该字段，
--   因此不再需要改名、移动文件或解析 `.trash/<ts>-<name>`。
-- - (provider, account_key) 在有效行内唯一：account_key 沿用旧文件名，作为来源内的
--   账号键；回收站行不参与，因此重登同名账号不会与已回收的旧行冲突。
--   account_id 沿用旧 `auth_index` 的派生方式，升级后外部引用（额度接口等）不变。
-- - 导入是一次性的：启动时读取 auth 目录与 .trash 目录，缺失的行才插入；文件保留在
--   磁盘作为冷备份，但运行期不再读写。
CREATE TABLE IF NOT EXISTS "LiteLLM_SubscriptionAccount" (
    "account_id" text PRIMARY KEY NOT NULL,
    "provider" text NOT NULL,
    "account_key" text NOT NULL,
    "payload" jsonb NOT NULL,
    "trashed_at" timestamp(3) with time zone,
    "created_at" timestamp(3) with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp(3) with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- 有效账号在来源内按账号键唯一，导入与投影都靠它幂等；回收站行不参与唯一约束，
-- 因此重登同名账号不会与已回收的旧行冲突（旧实现是回收站里同名文件加时间戳前缀）。
CREATE UNIQUE INDEX IF NOT EXISTS "idx_subscription_account_active_key"
    ON "LiteLLM_SubscriptionAccount" ("provider", "account_key")
    WHERE "trashed_at" IS NULL;
--> statement-breakpoint
-- 列表与回收站查询按有效性过滤，账号数很少但仍避免全表排序。
CREATE INDEX IF NOT EXISTS "idx_subscription_account_trashed"
    ON "LiteLLM_SubscriptionAccount" ("trashed_at");
