/**
 * RouterExecution fallback 派发 helper —— 抽取 CW/CP/general fallback 的链派发逻辑。
 *
 * 包含两个入口：
 *   - `tryRouteToFallback`     —— 真正的请求路径（200 response 检测或 catch 异常）
 *   - `tryRouteToFallbackForMock` —— mock_testing_* 入口的初始派发（不传 previousError）
 *
 * 为避免循环依赖，使用 `RouterExecutionRunner` 函数类型接收 executeWithFallback；
 * 本文件不直接 import RouterExecution.ts。
 */

import type { Deployment } from "../types/router";
import { ContextWindowExceededError, ContentPolicyViolationError } from "./RouterErrors";
import { logger } from "../core/utils/logger";
import type { RouterExecContext, ExecutionRequest, ExecutionHelpers } from "./RouterExecutionTypes";

/** 触发 fallback 派发的错误来源，仅用于日志后缀 */
export enum FallbackErrorKind {
	/** categorize_provider_error 把 200 但 body 不 OK 的响应分类为 CW/CP */
	Categorized = "categorized",
	/** catch 块里捕获到 CW/CP 异常 */
	Catch = "catch",
}

/** executeWithFallback 的最小化函数签名，避免反向 import 造成循环依赖 */
export type RouterExecutionRunner = (
	ctx: RouterExecContext,
	req: ExecutionRequest,
	helpers: ExecutionHelpers,
) => Promise<Record<string, unknown>>;

/**
 * mock 入口专用的 fallback 派发（不传 previousError，仅提高 fallbackDepth）。
 * 对齐 DIFF-EXEC-DEDUPE-02。
 * @param args - 见结构体字段
 * @param args.ctx - 执行上下文
 * @param args.req - 当前请求
 * @param args.helpers - executeWithFallback helpers
 * @param args.model - 当前 model 名
 * @param args.error - mock 钩子抛出的异常（CW / CP / 其它）
 * @param args.runExecution - 真正的执行入口（executeWithFallback）
 */
export function tryRouteToFallbackForMock(args: {
	ctx: RouterExecContext;
	req: ExecutionRequest;
	helpers: ExecutionHelpers;
	model: string;
	error: Error;
	runExecution: RouterExecutionRunner;
}): Promise<Record<string, unknown>> | null {
	const { ctx, req, helpers, model, error, runExecution } = args;
	if (error instanceof ContextWindowExceededError) {
		const chain = ctx.fallbackHandler.getContextWindowFallbackChain(model);
		const [firstChain] = chain;
		if (firstChain !== undefined) {
			return runExecution(ctx, { ...req, fallbackDepth: req.fallbackDepth + 1, model: firstChain }, helpers);
		}
	} else if (error instanceof ContentPolicyViolationError) {
		const chain = ctx.fallbackHandler.getContentPolicyFallbackChain(model);
		const [firstChain] = chain;
		if (firstChain !== undefined) {
			return runExecution(ctx, { ...req, fallbackDepth: req.fallbackDepth + 1, model: firstChain }, helpers);
		}
	}
	const general = ctx.fallbackHandler.getNextFallback(model, req.fallbackDepth);
	if (general) {
		return runExecution(ctx, { ...req, fallbackDepth: req.fallbackDepth + 1, model: general }, helpers);
	}
	return null;
}

/**
 * 抽取 CW/CP/general fallback 链派发逻辑（DIFF-EXEC-DEDUPE-01），
 * 消除 executeWithFallback 中重复的 `getChain(model) → executeWithFallback` 模板。
 * 按优先级：CW → CP → general fallback；任一命中则返回该 Promise，否则返回 null。
 * @param args - 见结构体字段
 * @param args.ctx - 执行上下文
 * @param args.req - 当前请求（用于更新 fallbackDepth/previousError）
 * @param args.helpers - executeWithFallback 的 helpers
 * @param args.model - 当前 model 名（解析 fallback chain）
 * @param args.error - 触发 fallback 的异常
 * @param args.deployment - 当前 deployment（用于日志）
 * @param args.errorKind - Categorized / Catch，仅用于日志上下文
 * @param args.runExecution - 真正的执行入口（executeWithFallback）
 */
export function tryRouteToFallback(args: {
	ctx: RouterExecContext;
	req: ExecutionRequest;
	helpers: ExecutionHelpers;
	model: string;
	error: Error;
	deployment: Deployment;
	errorKind: FallbackErrorKind;
	runExecution: RouterExecutionRunner;
}): Promise<Record<string, unknown>> | null {
	const { ctx, req, helpers, model, error, deployment, errorKind, runExecution } = args;
	const suffix = errorKind === FallbackErrorKind.Catch ? " (catch)" : "";
	if (error instanceof ContextWindowExceededError) {
		const chain = ctx.fallbackHandler.getContextWindowFallbackChain(model);
		const [firstChain] = chain;
		if (firstChain !== undefined) {
			logger.warn(`Context window error on ${deployment.model_name}${suffix}, trying context window fallback`);
			return runExecution(ctx, { ...req, fallbackDepth: req.fallbackDepth + 1, model: firstChain, previousError: error }, helpers);
		}
	} else if (error instanceof ContentPolicyViolationError) {
		const chain = ctx.fallbackHandler.getContentPolicyFallbackChain(model);
		const [firstChain] = chain;
		if (firstChain !== undefined) {
			logger.warn(`Content policy error on ${deployment.model_name}${suffix}, trying content policy fallback`);
			return runExecution(ctx, { ...req, fallbackDepth: req.fallbackDepth + 1, model: firstChain, previousError: error }, helpers);
		}
	}
	const general = ctx.fallbackHandler.getNextFallback(model, req.fallbackDepth);
	if (general) {
		return runExecution(ctx, { ...req, fallbackDepth: req.fallbackDepth + 1, model: general, previousError: error }, helpers);
	}
	return null;
}
