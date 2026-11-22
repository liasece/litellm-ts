/**
 * 预算守卫中间件。
 *
 * 目的是把「这次请求要不要做预算工作」提前判定一次，而不是让费用预留自己重新推导：
 * - 没有任何带上限的预算主体：预留环节连估算都不必做，直接跳过；
 * - 有预算但余量远大于请求的费用上界（1 字节 = 1 token 的严格上界）：直接按上界预留，省掉整包 cl100k 分词；
 * - 余量不足以判断：走精确估算与带锁预留，语义与过去一致。
 *
 * 判定只依赖鉴权阶段已经取到的 `budget_snapshots`，因此不额外查库；真正确认余量与
 * 并发占用仍由 `reserveSpend` 的预算锁负责，这里不缓存、不代替它做扣减。
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createModuleLogger } from "../core/utils/logger";
import { classifyRoute } from "../observability/RouteClassifier";
import type { BudgetSnapshot, UserAPIKeyAuth } from "../types/auth";

const logger = createModuleLogger("Auth:BudgetGuard");

/** 预算守卫结论；挂在 `req.budgetGuard` 上供预留环节读取。 */
export interface BudgetGuardDecision {
	/** 是否存在任何带上限的预算主体 */
	readonly budgeted: boolean;
	/** 各预算主体剩余额度（max_budget - spend）的最小值；budgeted 为 false 时为 null */
	readonly headroom: number | null;
	/** 已耗尽（headroom <= 0）的预算主体键；未耗尽时为 null */
	readonly exhaustedScope: string | null;
}

/** 需要预算守卫的路径前缀；其余路由（模型列表、管理接口等）只做鉴权，不参与预算判定。 */
const GUARDED_ROUTE_PREFIXES = [
	"/v1/messages",
	"/v1/chat/completions",
	"/v1/completions",
	"/v1/responses",
	"/responses",
	"/v1/embeddings",
	"/v1/images",
	"/v1/audio",
	"/v1/moderations",
] as const;

declare global {
	namespace Express {
		interface Request {
			/**
			 * 预算守卫结论：由 `budgetGuardMiddleware` 写入，费用预留据此选择精确/近似口径。
			 * 未经过守卫的调用（单测、内部调用）保持 undefined，走既有精确语义。
			 */
			budgetGuard?: BudgetGuardDecision;
		}
	}
}

/**
 * 是否为需要预算判定的推理路由。
 * @param path - `req.path`
 */
export function isBudgetGuardedRoute(path: string): boolean {
	for (const prefix of GUARDED_ROUTE_PREFIXES) {
		if (path === prefix || path.startsWith(`${prefix}/`)) {
			return true;
		}
	}
	return false;
}

/**
 * 从鉴权上下文推导预算结论。
 *
 * 只认 `max_budget` 非空的快照：没有上限的预算主体不产生余量约束，也不该让请求多付
 * 一次估算成本。同一请求可能有多个独立核算的预算主体，取余量最小者作为判定依据。
 * @param auth - 鉴权上下文
 */
export function evaluateBudgetGuard(auth: UserAPIKeyAuth | undefined): BudgetGuardDecision {
	const snapshots = auth?.budget_snapshots;
	let headroom: number | null = null;
	let exhaustedScope: string | null = null;
	const consider = (scope: string, snapshot: BudgetSnapshot | undefined): void => {
		const maxBudget = snapshot?.max_budget;
		if (maxBudget == null || !Number.isFinite(maxBudget)) {
			return;
		}
		const remaining = maxBudget - (Number.isFinite(snapshot?.spend) ? (snapshot?.spend as number) : 0);
		if (headroom === null || remaining < headroom) {
			headroom = remaining;
		}
		if (remaining <= 0 && exhaustedScope === null) {
			exhaustedScope = scope;
		}
	};
	if (snapshots !== undefined) {
		consider("key", snapshots.key);
		consider("user", snapshots.user);
		consider("team", snapshots.team);
		consider("organization", snapshots.organization);
		consider("project", snapshots.project);
		consider("team_member", snapshots.team_member);
		consider("end_user", snapshots.end_user);
	} else if (auth?.max_budget != null && Number.isFinite(auth.max_budget)) {
		// 兼容 master key/JWT 或旧调用方尚未提供快照的认证上下文。
		consider("key", { id: "legacy", spend: auth.spend ?? 0, max_budget: auth.max_budget });
	}
	return { budgeted: headroom !== null, headroom: headroom, exhaustedScope: exhaustedScope };
}

/**
 * 预算守卫中间件；必须挂在鉴权之后。
 * @param req - Express 请求
 * @param _res - Express 响应
 * @param next - 下一个中间件
 */
export function budgetGuardMiddleware(req: Request, _res: Response, next: NextFunction): void {
	if (!isBudgetGuardedRoute(req.path)) {
		next();
		return;
	}
	const decision = evaluateBudgetGuard(req.auth);
	req.budgetGuard = decision;
	if (decision.exhaustedScope !== null) {
		// 只做提示：是否为该错误码由后续 common checks 决定，避免与 401/403 的判定顺序互相覆盖。
		logger.debug("预算余量已耗尽", { scope: decision.exhaustedScope, route: classifyRoute(req.path) });
	}
	next();
}

/**
 * 需要显式挂载时使用的工厂；与 `budgetGuardMiddleware` 等价。
 */
export function createBudgetGuardMiddleware(): RequestHandler {
	return budgetGuardMiddleware;
}
