-- SpendLogs 的单价与峰谷档位投影。
--
-- 单价会变：上游调价、部署改价、价目表更新。请求结束时实际计费的单价、以及当时命中的
-- 峰谷档位是账单事实，原先只写在 metadata.cost_breakdown.price_snapshot 里。JSON 存在
-- TOAST 上，列表投影、导出和按单价查询都要先 detoast 整份 metadata；metadata 的内容
-- 控制还可能把这段裁掉。这里把两个事实投影成小列：
-- - unit_prices：本行实收的每 token 单价（已含峰时倍率），键与
--   price_snapshot.unit_prices 相同；未乘倍率的基础价仍留在 metadata 里供核对。
-- - peak_tier：请求开始时命中的档位 peak / off_peak；部署未配置峰谷时为 NULL。
-- 同一迁移内回填历史行，避免新列上线后出现一段读不到价格的窗口。
ALTER TABLE "LiteLLM_SpendLogs" ADD COLUMN IF NOT EXISTS "unit_prices" jsonb;--> statement-breakpoint
ALTER TABLE "LiteLLM_SpendLogs" ADD COLUMN IF NOT EXISTS "peak_tier" text;--> statement-breakpoint
COMMENT ON COLUMN "LiteLLM_SpendLogs"."unit_prices" IS '本行实收 per-token 单价（已含峰时倍率）；基础价见 metadata.cost_breakdown.price_snapshot.unit_prices';--> statement-breakpoint
COMMENT ON COLUMN "LiteLLM_SpendLogs"."peak_tier" IS '请求开始时命中的峰谷档位：peak / off_peak；未配置峰谷为 NULL';--> statement-breakpoint
-- 回填：一条语句扫一遍 metadata，两列同源写入（分开写要各自 detoast 一遍整表）。
-- - peak_tier 直接取请求时冻结的 price_tier，与是否有单价快照无关。
-- - unit_prices = 快照基础价 × 当时的 price_multiplier（缺省 1，即未配置峰谷的历史行）；
--   只处理 JSON object 且每个值都能转 numeric 的行，历史脏值留给读侧回退 metadata。
UPDATE "LiteLLM_SpendLogs" AS s
SET
	"peak_tier" = CASE
		WHEN s.metadata -> 'cost_breakdown' ->> 'price_tier' IN ('peak', 'off_peak')
			THEN s.metadata -> 'cost_breakdown' ->> 'price_tier'
	END,
	"unit_prices" = CASE
		WHEN jsonb_typeof(s.metadata -> 'cost_breakdown' -> 'price_snapshot' -> 'unit_prices') = 'object'
			AND NOT EXISTS (
				SELECT 1
				FROM jsonb_each_text(s.metadata -> 'cost_breakdown' -> 'price_snapshot' -> 'unit_prices') AS bad
				WHERE bad.value !~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$'
			)
			THEN (
				SELECT jsonb_object_agg(
					e.key,
					e.value::numeric * COALESCE((s.metadata -> 'cost_breakdown' ->> 'price_multiplier')::numeric, 1)
				)
				FROM jsonb_each_text(s.metadata -> 'cost_breakdown' -> 'price_snapshot' -> 'unit_prices') AS e
			)
	END
WHERE s.metadata -> 'cost_breakdown' ->> 'price_tier' IN ('peak', 'off_peak')
	OR jsonb_typeof(s.metadata -> 'cost_breakdown' -> 'price_snapshot' -> 'unit_prices') = 'object';
