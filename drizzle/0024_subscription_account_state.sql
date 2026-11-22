-- 订阅账号调度状态：最近失败时间与额度耗尽截止时间。
--
-- 这两项原先只在进程内存里：容器重启后冷却清空，之后每个请求都要用真实失败重新
-- 发现「这个账号这周没额度」，代价是每个请求都先撞一次墙。把它们落到账号维度的一行，
-- 启动时恢复即可跳过已知不可用的账号；重置时间到了自然失效，不需要清理任务。
CREATE TABLE IF NOT EXISTS "LiteLLM_SubscriptionAccountState" (
	"account_id" text PRIMARY KEY,
	"provider" text NOT NULL,
	"last_failure_at" timestamp(3) with time zone,
	"exhausted_until" timestamp(3) with time zone,
	"reason" text,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
COMMENT ON TABLE "LiteLLM_SubscriptionAccountState" IS '订阅账号调度状态：最近失败时间与额度耗尽的截止时间，重启后恢复';--> statement-breakpoint
COMMENT ON COLUMN "LiteLLM_SubscriptionAccountState"."last_failure_at" IS '最近一次上游失败时间；用于优先使用最久没失败的账号';--> statement-breakpoint
COMMENT ON COLUMN "LiteLLM_SubscriptionAccountState"."exhausted_until" IS '额度耗尽的重置时间；到期即恢复调度，无需清理';
