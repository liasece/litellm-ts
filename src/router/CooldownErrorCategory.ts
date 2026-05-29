/**
 * CooldownErrorCategory — 冷却分类字符串的 enum 化
 *
 * 把 CooldownManager / RouterExecutor / AllowedFailsPolicy 之间流动的错误分类字符串
 * 集中到一个 enum，避免各处散落的裸字符串（"RateLimitError" / "TimeoutError" 等）
 * 导致的拼写错误与重构遗漏。
 *
 * 对齐 PY `AllowedFailsPolicy` 与 `cooldown_handlers.py` 的错误类别集合。
 */

import type { AllowedFailsPolicy } from "../types/router";
import {
	RateLimitError,
	ContentPolicyViolationError,
	ContextWindowExceededError,
	APIConnectionError,
	TimeoutError,
	AuthenticationError,
	BadRequestError,
} from "./RouterErrors";

/** 冷却与 AllowedFailsPolicy 派发所用的错误类别枚举 */
export enum CooldownErrorCategory {
	/** 429 限流错误，按 AllowedFailsPolicy.RateLimitError 阈值触发冷却 */
	RateLimitError = "RateLimitError",
	/** Provider 内容策略违规（如 OpenAI content_filter finish_reason），按 ContentPolicyViolationError 阈值 */
	ContentPolicyViolationError = "ContentPolicyViolationError",
	/** 401/403 认证错误（key 失效等），按 AuthenticationError 阈值 */
	AuthenticationError = "AuthenticationError",
	/** 超时/网络中断（含 APIConnectionError），按 TimeoutError 阈值 */
	TimeoutError = "TimeoutError",
	/** 400 客户端错误，含 ContextWindowExceededError 子类，按 BadRequestError 阈值 */
	BadRequestError = "BadRequestError",
	/** 5xx 服务端错误，按 InternalServerErrorAllowedFails 阈值（PY 唯一无独立 policy 字段的类别） */
	InternalServerError = "InternalServerError",
}

/** 类型安全的 AllowedFailsPolicy 字段映射（category → policy 字段） */
const CATEGORY_TO_POLICY_FIELD: Record<CooldownErrorCategory, keyof AllowedFailsPolicy> = {
	[CooldownErrorCategory.BadRequestError]: "BadRequestError",
	[CooldownErrorCategory.AuthenticationError]: "AuthenticationError",
	[CooldownErrorCategory.TimeoutError]: "TimeoutError",
	[CooldownErrorCategory.RateLimitError]: "RateLimitError",
	[CooldownErrorCategory.ContentPolicyViolationError]: "ContentPolicyViolationError",
	// InternalServerError 在 PY 中无独立 policy 字段
	[CooldownErrorCategory.InternalServerError]: "InternalServerErrorAllowedFails",
};

/**
 * 从 AllowedFailsPolicy 中按类别读取允许失败数。
 * 若该类别未在 policy 中配置或为 undefined 返回 undefined（调用方按"不限制"处理）。
 * @param policy - 用户配置的 AllowedFailsPolicy
 * @param category - 错误类别 enum
 */
export function getAllowedFailsForCategory(policy: AllowedFailsPolicy, category: CooldownErrorCategory): number | undefined {
	const field = CATEGORY_TO_POLICY_FIELD[category];
	return policy[field];
}

/**
 * 共享的 error → CooldownErrorCategory 分类实现。
 * 合并 CooldownManager._categorizeError 与 RouterExecutor.categorizeErrorForCooldown 的重复逻辑，
 * 统一以 enum 返回，避免字符串与 enum 在两处不一致。
 *
 * 规则（按 PY 优先级）：
 *   - 子类先于父类（ContextWindowExceededError → BadRequestError）
 *   - RateLimitError 单独一类
 *   - ContentPolicyViolationError 单独一类（即使继承 BadRequestError）
 *   - TimeoutError / APIConnectionError 归 TimeoutError
 *   - AuthenticationError 单独一类
 *   - BadRequestError 单独一类
 *   - 5xx 归 InternalServerError
 *   - 兜底 BadRequestError
 * @param error
 */
export function categorizeErrorForCooldown(error: Error | undefined): CooldownErrorCategory | undefined {
	if (!error) {
		return undefined;
	}
	// 子类优先（ContextWindowExceededError → BadRequestError；RateLimit/ContentPolicy 单飞）
	if (error instanceof RateLimitError) {
		return CooldownErrorCategory.RateLimitError;
	}
	if (error instanceof ContentPolicyViolationError) {
		return CooldownErrorCategory.ContentPolicyViolationError;
	}
	if (error instanceof ContextWindowExceededError) {
		return CooldownErrorCategory.BadRequestError;
	}
	if (error instanceof APIConnectionError || error instanceof TimeoutError) {
		return CooldownErrorCategory.TimeoutError;
	}
	if (error instanceof AuthenticationError) {
		return CooldownErrorCategory.AuthenticationError;
	}
	if (error instanceof BadRequestError) {
		return CooldownErrorCategory.BadRequestError;
	}
	// 兜底用 name 字符串（兼容裸 Error）
	const name = error.name;
	if (name === "RateLimitError") {
		return CooldownErrorCategory.RateLimitError;
	}
	if (name === "ContentPolicyViolationError") {
		return CooldownErrorCategory.ContentPolicyViolationError;
	}
	if (name === "ContextWindowExceededError") {
		return CooldownErrorCategory.BadRequestError;
	}
	if (name === "APIConnectionError" || name === "TimeoutError") {
		return CooldownErrorCategory.TimeoutError;
	}
	if (name === "AuthenticationError") {
		return CooldownErrorCategory.AuthenticationError;
	}
	if (name === "BadRequestError") {
		return CooldownErrorCategory.BadRequestError;
	}
	// 5xx 归 InternalServerError
	if (/5\d{2}/.exec(error.message) || error.message.includes("Internal Server Error") || error.message.includes("server_error")) {
		return CooldownErrorCategory.InternalServerError;
	}
	return undefined;
}
