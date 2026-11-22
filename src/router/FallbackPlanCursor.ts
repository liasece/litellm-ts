/**
 * 请求级 fallback 计划的游标。
 *
 * `FallbackHandler.getFallbackPlan` 把 fallback 配置展开成一棵深度优先的候选序列，
 * 但一次请求可能因为「无可用部署 / 限流 / 上游失败 / 流中断」从多个位置换候选。
 * 只有把序列和游标挂在请求上，所有分支才会沿着同一个顺序推进：
 * 换候选不再重新查「当前模型的下一个 fallback」（那会丢掉兄弟目标，也会绕开 recurse 开关）。
 *
 * 计划在首个 hop 生成：`ExecutionRequest.model` 就是原始请求模型，之后每次递归只改 `model`
 * 和游标。分支之间互不影响，因为每次递归都带一个新的请求对象。
 */

import type { FallbackPlanEntry } from "./FallbackHandler";
import type { ExecutionRequest, RouterExecContext } from "./RouterExecutionTypes";

/** 一次候选推进：命中的候选与推进后的游标。 */
export interface PlannedFallback {
	/** 本次要尝试的候选。 */
	entry: FallbackPlanEntry;
	/** 递归调用应携带的游标（该候选已消费）。 */
	cursor: number;
}

/**
 * 请求的 fallback 计划；尚未展开时按当前模型展开一次。
 *
 * 上限取 router 的 max_fallbacks：跳数由 `fallbackDepth` 计数，计划再长也不会被走到。
 * @param ctx - 路由执行上下文
 * @param req - 当前请求
 */
export function fallbackPlanFor(ctx: RouterExecContext, req: ExecutionRequest): FallbackPlanEntry[] {
	if (req.fallbackPlan) {
		return req.fallbackPlan;
	}
	const limit = ctx.maxFallbacks > 0 ? ctx.maxFallbacks : undefined;
	return limit === undefined ? ctx.fallbackHandler.getFallbackPlan(req.model) : ctx.fallbackHandler.getFallbackPlan(req.model, limit);
}

/**
 * 取计划中下一个候选，跳过已经试过的模型组。
 * @param ctx - 路由执行上下文
 * @param req - 当前请求
 * @param skip - 已经尝试过的模型组（按 resolvedModel 比较）
 * @returns 候选与推进后的游标；计划耗尽时返回 null
 */
export function nextPlannedFallback(ctx: RouterExecContext, req: ExecutionRequest, skip?: ReadonlySet<string>): PlannedFallback | null {
	const plan = fallbackPlanFor(ctx, req);
	for (let cursor = req.fallbackCursor ?? 0; cursor < plan.length; cursor++) {
		const entry = plan[cursor]!;
		if (skip?.has(entry.resolvedModel)) {
			continue;
		}
		return { entry: entry, cursor: cursor + 1 };
	}
	return null;
}
