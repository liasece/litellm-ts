/**
 * Cooldown Manager — 跟踪部署冷却状态，基于失败次数自适应调整冷却时间。
 * 对齐 Python litellm/router.py + cooldown_handlers.py。
 */

import type { AllowedFailsPolicy } from "../types/router";
import { APIConnectionError, TimeoutError } from "./RouterErrors";
import { createModuleLogger } from "../core/utils/logger";
import { readActiveFromBackend, hydrateActiveFromBackend } from "./CooldownRedisSync";
import { CooldownErrorCategory, categorizeErrorForCooldown, getAllowedFailsForCategory } from "./CooldownErrorCategory";
import type { CooldownCallback } from "./CooldownCallbacks";
import type { CooldownCacheValue, CooldownCacheBackend } from "./CooldownCacheTypes";
import { invokeCooldownCallbacks } from "./CooldownCallbacksInvoker";

const logger = createModuleLogger("CooldownManager");

/** 单部署 100% 故障率阈值（每分钟 1000 次），PY constants.py:88 允许 env 覆盖 */
const SINGLE_DEPLOYMENT_TRAFFIC_FAILURE_THRESHOLD = (() => {
	const envVal = typeof process !== "undefined" ? process.env?.LITELLM_SINGLE_DEPLOYMENT_TRAFFIC_FAILURE_THRESHOLD : undefined;
	const parsed = envVal != null ? parseInt(envVal, 10) : NaN;
	return !isNaN(parsed) && parsed > 0 ? parsed : 1000;
})();
/** PY cooldown_handlers.py:default_failure_threshold_percent = 0.5 */
const DEFAULT_FAILURE_THRESHOLD_PERCENT = 0.5;
/** PY cooldown_handlers.py:default_failure_threshold_minimum_requests = 5 */
const DEFAULT_FAILURE_THRESHOLD_MINIMUM_REQUESTS = 5;

/**
 * `_failedCalls` 缓存默认 TTL（毫秒）。
 * PY 中 `failed_calls.set_cache(ttl=cooldown_time)`，默认 cooldown_time = 60 秒；
 * 本常量与 Router 默认 cooldown 配置保持同源。
 */
const DEFAULT_FAILED_CALL_TTL_MS = 60_000;

/**
 * CooldownManager —— 跟踪部署冷却状态。
 *
 * 维护两类计数：
 *   1. `_cooldowns`：当前正在冷却的 deployment + 剩余冷却时间（含 status_code/exception 调试信息）
 *   2. `_failureCounts` / `_failedCalls`：滑窗失败率与 allowed_fails 阈值跟踪
 *
 * 写入时双写本地 Map + 可选 cacheBackend（Redis 等），远端失败不影响主路径；
 * 状态过期通过惰性 evict（isInCooldown / getActiveCooldowns 触发清理）。
 *
 * 对齐 Python litellm/router.py + cooldown_handlers.py。
 */
export class CooldownManager {
	/** GAP 10: 存储 CooldownCacheValue 对齐 PY DualCache（保留 status_code/exception_received 调试信息） */
	private _cooldowns: Map<string, CooldownCacheValue> = new Map();
	private _failureCounts = new Map<string, { failures: number; successes: number; minuteStart: number }>();
	private _disableCooldowns: boolean;
	/** PY allowed_fails 语义：null=不冷却；Infinity=不冷却；number=阈值；AllowedFailsPolicy=分类阈值 */
	private _allowedFails: number | AllowedFailsPolicy | null = null;
	/** 按 deploymentName 的失败计数（对齐 PY failed_calls flat cache） */
	private _failedCalls = new Map<string, number>();
	/** _failedCalls 时间戳，用于 TTL 过期清理（对齐 PY cache TTL） */
	private _failedCallTimestamps = new Map<string, number>();
	private _providerDefaultDeploymentIds: Set<string> = new Set();
	/** _failedCalls TTL 毫秒（对齐 PY cooldown_time 级 TTL） */
	private _failedCallTtlMs: number;
	/** GAP 10: 可选分布式 cache 后端（Redis 等）。写入双写本地+远端；远端失败不影响主路径。 */
	private _cacheBackend?: CooldownCacheBackend;
	/** DIFF-RT-01: 冷却事件回调列表（Prometheus / Slack alert）。同步/异步均可，异常被吞不影响主路径。 */
	private _cooldownCallbacks: CooldownCallback[] = [];

	/**
	 * @param disableCooldowns - 禁用所有冷却
	 * @param allowedFails - 默认 null（PY 行为），Infinity 也表示不冷却
	 * @param providerDefaultDeploymentIds - 跳过冷却的默认部署列表（PY cooldown_handlers.py:157-161）
	 * @param cooldownTimeMs - _failedCalls TTL 毫秒，缺省 DEFAULT_FAILED_CALL_TTL_MS
	 * @param cacheBackend - 可选分布式 cache 后端
	 * @param cooldownCallbacks - 冷却事件回调列表
	 */
	constructor(
		disableCooldowns = false,
		allowedFails: number | AllowedFailsPolicy | null = null,
		providerDefaultDeploymentIds: string[] = [],
		cooldownTimeMs = DEFAULT_FAILED_CALL_TTL_MS,
		cacheBackend?: CooldownCacheBackend,
		cooldownCallbacks?: CooldownCallback[],
	) {
		this._disableCooldowns = disableCooldowns;
		this._allowedFails = allowedFails;
		this._providerDefaultDeploymentIds = new Set(providerDefaultDeploymentIds);
		this._failedCallTtlMs = cooldownTimeMs;
		this._cacheBackend = cacheBackend;
		this._cooldownCallbacks = cooldownCallbacks ?? [];
	}

	/**
	 * DIFF-RT-01: 注册冷却事件回调（同步/异步均可，异常被吞不影响主路径）
	 * @param callback
	 */
	addCooldownCallback(callback: CooldownCallback): void {
		this._cooldownCallbacks.push(callback);
	}

	/**
	 * 检查 deployment 是否在 provider_default_deployment_ids 中（跳过冷却）
	 * @param deploymentKey
	 */
	isDefaultDeployment(deploymentKey: string): boolean {
		return this._providerDefaultDeploymentIds.has(deploymentKey);
	}

	/**
	 * Mark a deployment as failed, start cooldown.
	 * GAP 10: 写入完整 CooldownCacheValue 并 best-effort 同步到可选 cacheBackend；触发 DIFF-RT-01 回调。
	 * @param deploymentName - deployment identifier
	 * @param cooldownTimeMs - cooldown duration in milliseconds
	 * @param statusCode - HTTP 状态码
	 * @param exceptionReceived - 异常字符串
	 */
	markFailed(deploymentName: string, cooldownTimeMs: number, statusCode = 0, exceptionReceived = ""): void {
		if (this._disableCooldowns) {
			return;
		}
		const value: CooldownCacheValue = {
			// eslint-disable-next-line camelcase
			exception_received: exceptionReceived,
			status_code: statusCode,
			timestamp: Date.now(),
			cooldown_time: cooldownTimeMs,
		};
		this._cooldowns.set(deploymentName, value);
		if (this._cacheBackend) {
			void Promise.resolve(this._cacheBackend.setCooldown(deploymentName, value)).catch(() => {
				// 远端写入失败不影响主路径
			});
		}
		invokeCooldownCallbacks(logger, this._cooldownCallbacks, deploymentName, cooldownTimeMs, statusCode, exceptionReceived);
	}

	/**
	 * DIFF-CD-CLEANUP-01: 过期清理 + backend delete（共享给 isInCooldown/getActiveCooldowns/clearCooldown）
	 * @param deploymentName
	 */
	private _evictExpiredEntry(deploymentName: string): void {
		this._cooldowns.delete(deploymentName);
		if (this._cacheBackend) {
			void Promise.resolve(this._cacheBackend.deleteCooldown(deploymentName)).catch(() => {
				// 远端清理失败忽略
			});
		}
	}

	/**
	 * Check if a deployment is in cooldown (过期时自动清理)
	 * @param deploymentName
	 */
	isInCooldown(deploymentName: string): boolean {
		const value = this._cooldowns.get(deploymentName);
		if (value === undefined) {
			return false;
		}
		const expiry = value.timestamp + value.cooldown_time;
		if (Date.now() > expiry) {
			this._evictExpiredEntry(deploymentName);
			return false;
		}
		return true;
	}

	/**
	 * GAP 10: 异步 cooldown 检查（查 backend），对齐 PY `async_get_active_cooldowns` DualCache 读路径
	 * @param deploymentName
	 */
	async isInCooldownAsync(deploymentName: string): Promise<boolean> {
		if (this._cooldowns.has(deploymentName)) {
			return this.isInCooldown(deploymentName);
		}
		if (!this._cacheBackend) {
			return false;
		}
		const remote = await readActiveFromBackend(this._cacheBackend, deploymentName);
		if (!remote) {
			return false;
		}
		this._cooldowns.set(deploymentName, remote);
		return true;
	}

	/**
	 * GAP 10: 从 backend 拉取 deployment cooldown 状态 warm 本地 Map，对齐 PY `async_get_active_cooldowns(model_ids)`
	 * @param deploymentNames
	 */
	async hydrateFromBackend(deploymentNames: string[]): Promise<void> {
		if (!this._cacheBackend) {
			return;
		}
		const hydrated = await hydrateActiveFromBackend(this._cacheBackend, deploymentNames, (name) => this._cooldowns.has(name));
		for (const [name, value] of hydrated) {
			this._cooldowns.set(name, value);
		}
	}

	/**
	 * Clear cooldown for a deployment (on success)。DIFF-CD-CLEANUP-02: 复用 _evictExpiredEntry
	 * @param deploymentName
	 */
	clearCooldown(deploymentName: string): void {
		this._evictExpiredEntry(deploymentName);
	}

	/**
	 * Get remaining cooldown time in ms, 0 if not in cooldown
	 * @param deploymentName
	 */
	getRemainingCooldown(deploymentName: string): number {
		const value = this._cooldowns.get(deploymentName);
		if (value === undefined) {
			return 0;
		}
		const remaining = value.timestamp + value.cooldown_time - Date.now();
		return remaining > 0 ? remaining : 0;
	}

	/**
	 * GAP 10: 获取冷却条目的完整 CooldownCacheValue（调试/监控用，对齐 PY cache.get_cache）
	 * @param deploymentName
	 */
	getCooldownValue(deploymentName: string): CooldownCacheValue | undefined {
		return this._cooldowns.get(deploymentName);
	}

	/**
	 * DIFF-RT-02: 跨 deployment 聚合 — 返回一组 deployment 的最小剩余冷却时间（毫秒）。对齐 PY `get_min_cooldown`
	 * @param deploymentNames
	 */
	getMinCooldown(deploymentNames: string[]): number {
		let minMs = Number.POSITIVE_INFINITY;
		for (const name of deploymentNames) {
			const remaining = this.getRemainingCooldown(name);
			if (remaining > 0 && remaining < minMs) {
				minMs = remaining;
			}
		}
		return Number.isFinite(minMs) ? minMs : 0;
	}

	/**
	 * DIFF-RT-04: 跨 deployment 列表查询 — 返回当前所有活跃冷却条目（已过期条目会被内部清理）。对齐 PY `_async_get_cooldown_deployments`
	 * @param deploymentNames
	 */
	getActiveCooldowns(deploymentNames: string[]): Array<[string, CooldownCacheValue]> {
		const result: Array<[string, CooldownCacheValue]> = [];
		for (const name of deploymentNames) {
			const value = this._cooldowns.get(name);
			if (value === undefined) {
				continue;
			}
			const remaining = value.timestamp + value.cooldown_time - Date.now();
			if (remaining > 0) {
				result.push([name, value]);
			} else {
				this._evictExpiredEntry(name);
			}
		}
		return result;
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
	 * PY _is_cooldown_required: 检查状态码是否属于冷却白名单（429/401/408/404/5xx）
	 * @param statusCode
	 */
	private _isStatusCodeCooldownTarget(statusCode: number): boolean {
		if (statusCode === 429 || statusCode === 401 || statusCode === 408 || statusCode === 404 || statusCode >= 500) {
			return true;
		}
		return false;
	}

	/**
	 * 故障率检查（单部署 100% / 1000 reqs + 多部署 >50% / 5 reqs，对齐 PY cooldown_handlers.py:227-239）
	 * @param deploymentName
	 * @param sameGroupDeploymentCount
	 */
	private _evaluateFailureRates(deploymentName: string, sameGroupDeploymentCount: number): boolean {
		// 100% failure rate check for single-deployment model groups
		if (sameGroupDeploymentCount <= 1) {
			this._pruneMinute(deploymentName);
			const counts = this._failureCounts.get(deploymentName);
			if (counts && counts.failures >= SINGLE_DEPLOYMENT_TRAFFIC_FAILURE_THRESHOLD && counts.successes === 0) {
				return true;
			}
		}
		// >50% fail rate with >=5 requests in the minute（单部署组豁免，100% 阈值已覆盖）
		if (sameGroupDeploymentCount > 1) {
			this._pruneMinute(deploymentName);
			const counts = this._failureCounts.get(deploymentName);
			if (counts) {
				const total = counts.failures + counts.successes;
				if (total >= DEFAULT_FAILURE_THRESHOLD_MINIMUM_REQUESTS && counts.failures / total > DEFAULT_FAILURE_THRESHOLD_PERCENT) {
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * GAP 3: PY `_should_cooldown_deployment` 拆分为两阶段：
	 *   1. `_shouldCooldownDeployment` — 状态码白名单 + v2
	 *   2. `shouldCooldownByAllowedFails` — allowed_fails 阈值（fallback 分支）
	 * GAP 2 各类边界与 PY 行为完全一致。
	 * @param deploymentName - deployment identifier
	 * @param statusCode - HTTP status code
	 * @param exceptionStr - error message for APIConnectionError detection
	 * @param sameGroupDeploymentCount - number of deployments in the same model group
	 * @param errorCategory - 错误类别（CooldownErrorCategory 优先；为兼容外部调用也接受等值字符串）
	 * @param originalException
	 * @param deploymentAllowedFails
	 * @returns true if cooldown should be applied
	 */
	// eslint-disable-next-line max-params
	isCooldownRequired(
		deploymentName: string,
		statusCode: number,
		exceptionStr?: string,
		sameGroupDeploymentCount = 2,
		errorCategory?: CooldownErrorCategory | string,
		originalException?: Error,
		deploymentAllowedFails?: number | AllowedFailsPolicy,
	): boolean {
		if (this._disableCooldowns) {
			return false;
		}
		// provider_default_deployment_ids 跳过冷却（PY cooldown_handlers.py:157-161）
		if (this._providerDefaultDeploymentIds.size > 0 && this._providerDefaultDeploymentIds.has(deploymentName)) {
			return false;
		}
		// DIFF-002: APIConnectionError / TimeoutError 实例/字符串/errorCategory 三重判定豁免
		// （PY cooldown_handlers.py:57-63；TS 用 instanceof 优先避免 message 漏检）
		if (originalException instanceof APIConnectionError || originalException instanceof TimeoutError) {
			return false;
		}
		if (exceptionStr?.includes("APIConnectionError") || exceptionStr?.includes("TimeoutError")) {
			return false;
		}
		if (errorCategory === CooldownErrorCategory.TimeoutError) {
			return false;
		}
		// PY _is_cooldown_required: 不在状态码白名单即使 allowed_fails 超限也不冷却
		if (!this._isStatusCodeCooldownTarget(statusCode)) {
			return false;
		}
		// GAP 3 — Stage 1: PY _should_cooldown_deployment 主分支（v2 路径）
		if (this._shouldCooldownDeployment(deploymentName, statusCode, sameGroupDeploymentCount)) {
			return true;
		}
		// GAP 3 — Stage 2: fallback 到 allowed_fails policy；DIFF-RT-03 支持 deployment-level override
		const effectiveAllowedFails = deploymentAllowedFails ?? this._allowedFails;
		// GAP 2: 优先传 originalException 让下游通过 instanceof 派发子类（如 CW → BadRequestError）
		const errFromStr = originalException ?? (exceptionStr ? new Error(exceptionStr) : undefined);
		return this.shouldCooldownByAllowedFails(deploymentName, errFromStr, errorCategory, effectiveAllowedFails);
	}

	/**
	 * GAP 3 Stage 1: PY `_should_cooldown_deployment` 主分支（cooldown_handlers.py:166-257）。
	 * 严格按 PY 顺序：1) 429 multi-deploy  2) percent_fails (single/multi)  3) _should_retry==False。
	 * @param deploymentName
	 * @param statusCode
	 * @param sameGroupDeploymentCount
	 */
	private _shouldCooldownDeployment(deploymentName: string, statusCode: number, sameGroupDeploymentCount: number): boolean {
		// PY 顺序 1: 429 multi-deploy early-exit
		if (statusCode === 429 && sameGroupDeploymentCount > 1) {
			return true;
		}
		// PY 顺序 2: percent_fails（_evaluateFailureRates 内部分发 single/multi）
		if (this._evaluateFailureRates(deploymentName, sameGroupDeploymentCount)) {
			return true;
		}
		// PY 顺序 3: _should_retry==False 才冷却
		if (!this._shouldRetry(statusCode)) {
			return true;
		}
		// PY 顺序 4: 默认 return False
		return false;
	}

	/**
	 * 对齐 PY `should_cooldown_based_on_allowed_fails_policy`（cooldown_handlers.py:398-431）。
	 * DIFF-CD-ALLOWED-01: 支持 effectiveAllowedFails override 走 deployment-level。
	 * @param deploymentName - deployment identifier
	 * @param originalException - 原始 Error 对象，与 errorCategory 二选一
	 * @param errorCategory - 错误类别（CooldownErrorCategory 优先；为兼容外部调用也接受等值字符串）
	 * @param effectiveAllowedFails - deployment-level override（默认用 this._allowedFails）
	 * @returns true 如果冷却是必需的
	 */
	shouldCooldownByAllowedFails(
		deploymentName: string,
		originalException?: Error,
		errorCategory?: CooldownErrorCategory | string,
		effectiveAllowedFails: number | AllowedFailsPolicy | null | undefined = this._allowedFails,
	): boolean {
		// PY: None/Infinity 走 v2 路径，永不基于 allowed_fails 冷却
		if (effectiveAllowedFails === null || effectiveAllowedFails === undefined || effectiveAllowedFails === Infinity) {
			return false;
		}
		this._pruneFailedCalls();

		const currentFails = this._failedCalls.get(deploymentName) ?? 0;
		const updatedFails = currentFails + 1;

		// 计算 allowed 阈值（对齐 PY get_allowed_fails_from_policy + 回退到 router.allowed_fails）
		let allowed: number;
		if (typeof effectiveAllowedFails === "number") {
			if (effectiveAllowedFails === 0) {
				return false;
			}
			allowed = effectiveAllowedFails;
		} else {
			const policy = effectiveAllowedFails as AllowedFailsPolicy;
			const category = errorCategory ?? categorizeErrorForCooldown(originalException);
			if (category) {
				const fromPolicy = getAllowedFailsForCategory(policy, category as CooldownErrorCategory);
				// 类别未在 policy 中设置 → 不限制（-1）
				allowed = fromPolicy ?? -1;
			} else {
				allowed = -1;
			}
		}

		// allowed <= 0 没有限制，不记录也不冷却
		if (allowed <= 0) {
			return false;
		}

		// increment 后检查；超阈值 → 触发冷却（不存储本次 increment，PY 行为）
		if (updatedFails > allowed) {
			return true;
		}

		// 未超过阈值 → 存储 increment 带 TTL
		this._failedCalls.set(deploymentName, updatedFails);
		this._failedCallTimestamps.set(deploymentName, Date.now());
		return false;
	}

	/**
	 * PY _should_retry: 408/409/429 + 5xx 可重试。Used by isCooldownRequired 对齐 PY 行为
	 * @param statusCode
	 */
	private _shouldRetry(statusCode: number): boolean {
		if (statusCode === 408 || statusCode === 409 || statusCode === 429) {
			return true;
		}
		return statusCode >= 500;
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
	 * 对齐 PY failed_calls.set_cache(ttl=cooldown_time) auto-expiry。
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
