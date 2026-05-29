/**
 * Cooldown Manager
 *
 * 跟踪部署实例的冷却状态，基于失败次数自适应调整冷却时间。
 * 对齐 Python litellm/router.py 和 cooldown_handlers.py 的冷却逻辑。
 */

import type { AllowedFailsPolicy } from "../types/router";

/** 单部署模型组 100% 故障率阈值（每分钟 1000 次请求全部失败） */
const SINGLE_DEPLOYMENT_TRAFFIC_FAILURE_THRESHOLD = 1000;

/**
 * Cooldown Manager
 *
 * 跟踪部署实例的冷却状态，基于失败次数自适应调整冷却时间。
 */
export class CooldownManager {
	private _cooldowns: Map<string, number> = new Map();
	private _failureCounts = new Map<string, { failures: number; successes: number; minuteStart: number }>();
	private _disableCooldowns: boolean;
	private _allowedFails: number | AllowedFailsPolicy = 0;
	/** 按部署的失败计数（对齐 PY failed_calls flat cache），key = deploymentName */
	private _failedCalls = new Map<string, number>();
	/** 失败计数的时间戳（按部署），用于 TTL 过期清理（对齐 PY cache TTL） */
	private _failedCallTimestamps = new Map<string, number>();
	private _providerDefaultDeploymentIds: Set<string> = new Set();
	/** _failedCalls TTL（毫秒），对齐 PY cooldown_time 级 TTL */
	private _failedCallTtlMs: number;

	/**
	 * @param disableCooldowns
	 * @param allowedFails
	 * @param providerDefaultDeploymentIds - 默认部署列表，这些部署跳过冷却（PY cooldown_handlers.py:157-161）
	 * @param cooldownTimeMs - _failedCalls TTL（毫秒），默认 60000
	 */
	constructor(
		disableCooldowns = false,
		allowedFails: number | AllowedFailsPolicy = Infinity,
		providerDefaultDeploymentIds: string[] = [],
		cooldownTimeMs = 60000,
	) {
		this._disableCooldowns = disableCooldowns;
		this._allowedFails = allowedFails;
		this._providerDefaultDeploymentIds = new Set(providerDefaultDeploymentIds);
		this._failedCallTtlMs = cooldownTimeMs;
	}

	/**
	 * 检查 deployment 是否在 provider_default_deployment_ids 中（跳过冷却）
	 * @param deploymentKey
	 */
	isDefaultDeployment(deploymentKey: string): boolean {
		return this._providerDefaultDeploymentIds.has(deploymentKey);
	}

	/**
	 * Mark a deployment as failed, start cooldown
	 * @param deploymentName - deployment identifier
	 * @param cooldownTimeMs - cooldown duration in milliseconds
	 */
	markFailed(deploymentName: string, cooldownTimeMs: number): void {
		if (this._disableCooldowns) {
			return;
		}
		this._cooldowns.set(deploymentName, Date.now() + cooldownTimeMs);
	}

	/**
	 * Check if a deployment is in cooldown
	 * @param deploymentName - deployment identifier
	 * @returns true if currently in cooldown
	 */
	isInCooldown(deploymentName: string): boolean {
		const expiry = this._cooldowns.get(deploymentName);
		if (expiry === undefined) {
			return false;
		}

		if (Date.now() > expiry) {
			this._cooldowns.delete(deploymentName);
			return false;
		}

		return true;
	}

	/**
	 * Clear cooldown for a deployment (on success)
	 * @param deploymentName - deployment identifier
	 */
	clearCooldown(deploymentName: string): void {
		this._cooldowns.delete(deploymentName);
	}

	/**
	 * Get remaining cooldown time in ms, 0 if not in cooldown
	 * @param deploymentName - deployment identifier
	 * @returns remaining cooldown in milliseconds
	 */
	getRemainingCooldown(deploymentName: string): number {
		const expiry = this._cooldowns.get(deploymentName);
		if (expiry === undefined) {
			return 0;
		}

		const remaining = expiry - Date.now();
		return remaining > 0 ? remaining : 0;
	}

	// ========== Failure rate tracking ==========

	/**
	 * Record a successful request for failure rate tracking
	 * @param deploymentName
	 */
	recordSuccess(deploymentName: string): void {
		this._pruneMinute(deploymentName);
		const entry = this._failureCounts.get(deploymentName);
		if (entry) {
			entry.successes++;
		}
	}

	/**
	 * Record a failed request for failure rate tracking
	 * @param deploymentName
	 */
	recordFailure(deploymentName: string): void {
		this._pruneMinute(deploymentName);
		const entry = this._failureCounts.get(deploymentName);
		if (entry) {
			entry.failures++;
		} else {
			this._failureCounts.set(deploymentName, {
				failures: 1,
				successes: 0,
				minuteStart: Date.now(),
			});
		}
	}

	/**
	 * PY _is_cooldown_required — 检查状态码是否属于冷却白名单。
	 * 不在白名单中的状态码不会触发冷却（即使 allowed_fails 超限）。
	 * @param statusCode
	 */
	private _isStatusCodeCooldownTarget(statusCode: number): boolean {
		if (statusCode === 429 || statusCode === 401 || statusCode === 408 || statusCode === 404 || statusCode >= 500) {
			return true;
		}
		return false;
	}

	/**
	 * 故障率检查（单部署 100% + 多部署 >50%）
	 * @param deploymentName
	 * @param sameGroupDeploymentCount
	 */
	private _evaluateFailureRates(deploymentName: string, sameGroupDeploymentCount: number): boolean {
		// 100% failure rate check for single-deployment model groups
		// 对齐 PY cooldown_handlers.py:227-232
		if (sameGroupDeploymentCount <= 1) {
			this._pruneMinute(deploymentName);
			const counts = this._failureCounts.get(deploymentName);
			if (counts && counts.failures >= SINGLE_DEPLOYMENT_TRAFFIC_FAILURE_THRESHOLD && counts.successes === 0) {
				return true;
			}
		}
		// Failure rate check: >50% fail rate with >=5 requests in the minute
		// 单部署组豁免（PY cooldown_handlers.py:233-239），因为 100% 阈值已覆盖单部署情况
		if (sameGroupDeploymentCount > 1) {
			this._pruneMinute(deploymentName);
			const counts = this._failureCounts.get(deploymentName);
			if (counts) {
				const total = counts.failures + counts.successes;
				if (total >= 5 && counts.failures / total > 0.5) {
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * Determine if cooldown is required based on status code and failure rate.
	 * 对齐 Python _is_cooldown_required() 和 _should_cooldown_deployment().
	 *
	 * PY 流程：先 _is_cooldown_required(状态码白名单) → 然后在 _should_cooldown_deployment 中
	 * 检查 allowed_fails → 返回结果。不在白名单的状态码不触发冷却（即使 allowed_fails 超限）。
	 * @param deploymentName - deployment identifier
	 * @param statusCode - HTTP status code
	 * @param exceptionStr - error message for APIConnectionError detection
	 * @param sameGroupDeploymentCount - number of deployments in the same model group
	 * @param errorCategory - error category string for type-dispatch allowed_fails
	 * @returns true if cooldown should be applied
	 */
	isCooldownRequired(
		deploymentName: string,
		statusCode: number,
		exceptionStr?: string,
		sameGroupDeploymentCount = 2,
		errorCategory?: string,
	): boolean {
		if (this._disableCooldowns) {
			return false;
		}
		// provider_default_deployment_ids 跳过冷却（PY cooldown_handlers.py:157-161）
		if (this._providerDefaultDeploymentIds.size > 0 && this._providerDefaultDeploymentIds.has(deploymentName)) {
			return false;
		}
		// APIConnectionError -> no cooldown（PY cooldown_handlers.py:57-63）
		if (exceptionStr?.includes("APIConnectionError")) {
			return false;
		}
		// PY _is_cooldown_required: 先检查状态码是否在冷却白名单中。
		// 不在白名单的状态码（如 400）即使 allowed_fails 超限也不冷却。
		if (!this._isStatusCodeCooldownTarget(statusCode)) {
			return false;
		}
		// Allowed fails threshold check（在 _is_cooldown_required 通过之后）
		// PY should_cooldown_based_on_allowed_fails_policy: 在 check 内部原子化 increment + 判定
		if (this._allowedFails !== 0 && this.shouldCooldownByAllowedFails(deploymentName, errorCategory)) {
			return true;
		}
		// 4xx handling (对齐 PY _should_cooldown_deployment)
		if (statusCode >= 400 && statusCode < 500) {
			if (statusCode === 429) {
				// PY: multi-deployment 429 -> cool. Single-deployment: fall through to 4xx bottom -> no cool
				if (sameGroupDeploymentCount > 1) {
					return true;
				}
				// Single-deployment 429: falls through -> return false (no cooldown)
			}
			if (statusCode === 401) {
				return true;
			}
			// 403: PY does not check 403, falls into "other 4xx" -> no cooldown
			// 408: PY _should_cooldown_deployment does not match 429/401 so falls through -> no cooldown
			if (statusCode === 404) {
				return true;
			}
			// 其他 4xx（400 等）PY _is_cooldown_required 返回 false 不冷却
			return false;
		}
		// 5xx: cooldown
		if (statusCode >= 500) {
			return true;
		}
		// failure rate checks (fallback path for non-HTTP errors)
		if (this._evaluateFailureRates(deploymentName, sameGroupDeploymentCount)) {
			return true;
		}
		// Default: cooldown on unknown errors
		return true;
	}

	/**
	 * 对齐 PY should_cooldown_based_on_allowed_fails_policy。
	 * 使用 flat 计数器（按 deployment），在单次调用内原子化完成 increment + 判定 + 存储。
	 * PY 流程（cooldown_handlers.py:398-431）：
	 * 1. 通过 isinstance(exception) 从 AllowedFailsPolicy 获取类别阈值，失败回退到 router.allowed_fails
	 * 2. current_fails = failed_calls.get_cache(key=deployment) or 0
	 * 3. updated_fails = current_fails + 1
	 * 4. updated_fails > allowed_fails → 触发热却，不存储本次 increment
	 * 5. 否则 → set_cache(key, value=updated_fails, ttl=cooldown_time)，返回 false
	 * @param deploymentName - deployment identifier
	 * @param errorCategory - 错误类别（如 "AuthenticationError", "TimeoutError"），用于 AllowedFailsPolicy 分类阈值
	 * @returns true 如果冷却是必需的
	 */
	shouldCooldownByAllowedFails(deploymentName: string, errorCategory?: string): boolean {
		if (this._allowedFails === Infinity) {
			return false;
		}
		// 先清理过期条目
		this._pruneFailedCalls();

		// 获取当前 flat 计数
		const currentFails = this._failedCalls.get(deploymentName) ?? 0;
		const updatedFails = currentFails + 1;

		// 计算 allowed 阈值（对齐 PY get_allowed_fails_from_policy + 回退到 router.allowed_fails）
		let allowed: number;
		if (typeof this._allowedFails === "number") {
			allowed = this._allowedFails;
		} else {
			const policy = this._allowedFails as AllowedFailsPolicy;
			if (errorCategory) {
				const fromPolicy = this._getAllowedFailsForCategory(policy, errorCategory);
				// PY: 如果该类别在 policy 中未设置，不对该类别施加限制（不回退到 Infinity 以外的值）
				allowed = fromPolicy ?? -1;
			} else {
				// 无类别信息时不对任何类别施加限制（避免误伤）
				allowed = -1;
			}
		}

		// PY: 如果 allowed <= 0 没有限制（如类别不在 policy 中），不记录也不冷却
		if (allowed <= 0) {
			return false;
		}

		// PY: increment 后检查
		if (updatedFails > allowed) {
			// 超过阈值 → 热却。不存储本次 increment（PY 行为）
			return true;
		}

		// 未超过阈值 → 存储 increment 带 TTL
		this._failedCalls.set(deploymentName, updatedFails);
		this._failedCallTimestamps.set(deploymentName, Date.now());
		return false;
	}

	/**
	 * 获取指定错误类别在 AllowedFailsPolicy 中对应的允许失败数
	 * @param policy
	 * @param errorCategory
	 */
	private _getAllowedFailsForCategory(policy: AllowedFailsPolicy, errorCategory: string): number | undefined {
		switch (errorCategory) {
			case "BadRequestError":
				return policy.BadRequestError;
			case "AuthenticationError":
				return policy.AuthenticationError;
			case "TimeoutError":
				return policy.TimeoutError;
			case "RateLimitError":
				return policy.RateLimitError;
			case "ContentPolicyViolationError":
				return policy.ContentPolicyViolationError;
			case "InternalServerError":
				return policy.InternalServerErrorAllowedFails;
			default:
				return undefined;
		}
	}

	// ========== Private helpers ==========

	/**
	 * Reset failure counts if the current minute window has expired
	 * @param deploymentName
	 */
	private _pruneMinute(deploymentName: string): void {
		const entry = this._failureCounts.get(deploymentName);
		if (entry && Date.now() - entry.minuteStart > 60_000) {
			this._failureCounts.delete(deploymentName);
		}
	}

	/**
	 * Prune expired _failedCalls entries whose TTL has elapsed.
	 * Aligns with PY: failed_calls.set_cache(ttl=cooldown_time) auto-expiry.
	 * 简化：flat 存储，每条部署一个时间和一个计数。
	 */
	private _pruneFailedCalls(): void {
		const cutoff = Date.now() - this._failedCallTtlMs;
		for (const [depName, ts] of this._failedCallTimestamps) {
			if (ts < cutoff) {
				this._failedCalls.delete(depName);
				this._failedCallTimestamps.delete(depName);
			}
		}
	}
}
