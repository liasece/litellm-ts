/**
 * Routing Strategy Implementations
 *
 * Strategies for selecting the best deployment for a request.
 * Each function receives a list of deployments and routing context,
 * and returns the selected deployment or null if none available.
 */

import type { Deployment } from "../types/router";
import { RoutingStrategyName } from "../types/router";
import { lookupModelCostPerToken } from "../cost/CostCalculator";

export { RoutingStrategyName };

/**
 * simpleShuffle 单字段归一化的字段选择。
 * PY: 按 weight > rpm > tpm 顺序探测 healthy_deployments[0].litellm_params；
 * 找到的第一个非 undefined 字段被用作整组的归一化字段。
 *
 * 提取 enum 以替代裸字符串联合 — 避免后续 `fieldName === "weight"` 等比较出现 typo。
 */
enum SimpleShuffleField {
	Weight = "weight",
	Rpm = "rpm",
	Tpm = "tpm",
}

const SIMPLE_SHUFFLE_FIELD_ORDER: readonly SimpleShuffleField[] = [
	SimpleShuffleField.Weight,
	SimpleShuffleField.Rpm,
	SimpleShuffleField.Tpm,
];

/** Context provided to routing strategies */
export interface RoutingContext {
	/** All available deployments */
	deployments: Deployment[];
	/** TPM/RPM usage query (returns usage within current window) */
	tpmRpmLimiter: {
		getUsage(name: string): { tpm: number; rpm: number };
		/**
		 * GAP 9: 同步 check-and-reserve（节点内原子），用于 usage-based-routing-v2
		 * 在 pick 阶段执行 PY `async_pre_call_check` 等价的 atomic INCR check-then-act。
		 * 可选（缺省时退化为非原子的 getUsage + 选择）。
		 */
		tryReserveSync?(name: string, tpmLimit?: number, rpmLimit?: number, estimatedInputTokens?: number): boolean;
		/**
		 * DIFF-010: 回滚最近一次 tryReserveSync 占用的 RPM slot。
		 * 用于 usage-based-routing-v2 在 group-level reserve 失败时释放已占用 slot，
		 * 对齐 PY atomic transaction 行为（Redis INCR/DECR 配对）。
		 */
		rollbackReservation?(name: string): boolean;
	};
	/** Active request counts per deployment key */
	activeRequests: Map<string, number>;
	/**
	 * GAP 7: Per-token average latency per deployment key (ms / token).
	 * Aligned with PY `LowestLatencyLoggingHandler` which writes `response_seconds / completion_tokens`
	 * (lowest_latency.py:104-108). Router._executeWithFallback 在记录时 normalize 为 per-token；
	 * 当未拿到 completion_tokens 时回退到绝对 ms（首次请求或非 chat completion）。
	 */
	latencies: Map<string, number>;
	/** Estimated input tokens for the request (for usage-based pre-check) */
	estimatedInputTokens?: number;
	/**
	 * GAP 7: Per-token TTFT (time-to-first-token) per deployment key (ms / token), used by
	 * latencyBasedRouting for streaming requests. 与非 stream latencies 同样 normalize。
	 */
	ttft?: Map<string, number>;
	/** Whether the current request is streaming — used by latencyBasedRouting to decide TTFT vs total latency, aligning with PY request_kwargs.get("stream") */
	isStream?: boolean;
	/** Global model cost map: model_id -> { input_cost_per_token, output_cost_per_token }, aligned with PY litellm.model_cost */
	modelCostMap?: Record<string, { input_cost_per_token: number; output_cost_per_token: number }>;
}

/**
 * Build a deployment-level key matching Router._getDeploymentKey.
 * Used for per-deployment active request tracking.
 * @param dep
 */
/**
 * Extract tpm with fallback: litellm_params.tpm -> model_info.tpm
 * PY checks: deployment["tpm"], deployment["rpm"], deployment["model_info"]["tpm"], deployment["model_info"]["rpm"]
 * in addition to dep.litellm_params.tpm/rpm.
 * @param dep
 */
function _getTpm(dep: Deployment): number | undefined {
	return dep.tpm ?? dep.litellm_params.tpm ?? dep.model_info?.tpm;
}
function _getRpm(dep: Deployment): number | undefined {
	return dep.rpm ?? dep.litellm_params.rpm ?? dep.model_info?.rpm;
}

/**
 * @param dep
 */
export function deploymentKey(dep: Deployment): string {
	return dep.model_info?.id ?? dep.model_name;
}

/**
 * Simple weighted shuffle routing.
 *
 * Aligns with PY simple_shuffle: checks first deployment for params,
 * then normalizes by a single field (weight > rpm > tpm).
 * No params -> pure random. No TPM/RPM pre-filter (PY does not filter).
 * @param deployments
 * @param ctx
 */
export function simpleShuffle(deployments: Deployment[], ctx: RoutingContext): Deployment | null {
	if (deployments.length === 0) {
		return null;
	}

	// PY: only check healthy_deployments[0].litellm_params for field detection (no model_info fallback)
	const firstDep = deployments[0]!;
	let fieldName: SimpleShuffleField | null = null;
	for (const f of SIMPLE_SHUFFLE_FIELD_ORDER) {
		if (firstDep.litellm_params[f] !== undefined) {
			fieldName = f;
			break;
		}
	}

	// Pure random if no params configured on any deployment
	if (!fieldName) {
		return deployments[Math.floor(Math.random() * deployments.length)] ?? null;
	}

	const candidates: Array<{ deployment: Deployment; weight: number }> = [];

	for (const dep of deployments) {
		const params = dep.litellm_params;
		let weight = 1;

		// PY: single-field normalization — fieldName determined above; allows zero weight
		if (fieldName === SimpleShuffleField.Weight) {
			weight = params.weight ?? 0;
		} else if (fieldName === SimpleShuffleField.Rpm) {
			weight = params.rpm ?? 0;
		} else if (fieldName === SimpleShuffleField.Tpm) {
			weight = params.tpm ?? 0;
		}
		candidates.push({ deployment: dep, weight: weight });
	}

	// Weighted random selection
	// PY uses random.choices (weighted pick) which IGNORES zero-weight entries.
	// We mirror that: only sum positive weights, then pick among the non-zero pool.
	// (PY `random.choices` returns an IndexError when ALL weights are zero.)
	const nonZeroCandidates = candidates.filter((c) => c.weight > 0);
	if (nonZeroCandidates.length === 0) {
		// All weights are zero — fall back to uniform random
		return deployments[Math.floor(Math.random() * deployments.length)] ?? null;
	}
	const totalWeight = nonZeroCandidates.reduce((sum, c) => sum + c.weight, 0);
	let random = Math.random() * totalWeight;

	for (const candidate of nonZeroCandidates) {
		random -= candidate.weight;
		if (random <= 0) {
			return candidate.deployment;
		}
	}

	return nonZeroCandidates[nonZeroCandidates.length - 1]!.deployment;
}

/**
 * Least-busy routing.
 *
 * Picks the deployment with the fewest active in-flight requests.
 * PY: min_traffic=float("inf"); if v < min_traffic 严格小于 — equal 永不更新
 * 等价于 active 全是 Infinity 时不返回结果，fallback 到随机。
 * @param deployments
 * @param ctx
 */
export function leastBusy(deployments: Deployment[], ctx: RoutingContext): Deployment | null {
	if (deployments.length === 0) {
		return null;
	}

	let best: Deployment | null = null;
	let minActive = Infinity;
	let found = false;

	for (const dep of deployments) {
		const active = ctx.activeRequests.get(deploymentKey(dep)) ?? 0;
		// PY: 严格小于 — active === Infinity 时永不更新
		if (active < minActive) {
			minActive = active;
			best = dep;
			found = true;
		}
	}

	// PY: fallback to random choice when no best found (e.g. all deployments have Infinity traffic)
	if (!found && deployments.length > 0) {
		return deployments[Math.floor(Math.random() * deployments.length)] ?? null;
	}

	return best;
}

/**
 * Usage-based routing.
 *
 * Aligns with PY lowest_tpm_rpm: finds deployment with lowest absolute TPM usage.
 * Checks input_tokens + current_tpm <= tpm_limit and rpm + 1 < rpm_limit.
 * Falls back to simpleShuffle when no limits are configured.
 * @param deployments
 * @param ctx
 */
export function usageBasedRouting(deployments: Deployment[], ctx: RoutingContext): Deployment | null {
	if (deployments.length === 0) {
		return null;
	}

	let best: Deployment | null = null;
	let bestTpmUsage = Infinity;

	for (const dep of deployments) {
		// PY: resolve TPM/RPM limits with 3-level fallback: deployment.tpm -> litellm_params.tpm -> model_info.tpm
		const tpmLimit = _getTpm(dep);
		const rpmLimit = _getRpm(dep);
		// PY: use deployment-level key (model_info.id) for per-deployment tracking
		const usage = ctx.tpmRpmLimiter.getUsage(deploymentKey(dep));

		// PY: input_tokens + item_tpm > _deployment_tpm (strict >)
		const projectedTpm = usage.tpm + (ctx.estimatedInputTokens ?? 0);
		if (tpmLimit !== undefined && projectedTpm > tpmLimit) {
			continue;
		}
		// PY: rpm + 1 < _deployment_rpm (keep 1 slot buffer)
		if (rpmLimit !== undefined && usage.rpm + 1 >= rpmLimit) {
			continue;
		}

		// PY: LowestTPMLoggingHandler.get_available_deployments
		// 遇到 tpm_dict[model_id] 为 None 时初始化为 {model_id: 0}，然后 v=0 与 Infinity 比较
		// 我们在 tpmRpmLimiter 缺失时返回 0，与 PY 行为等价
		const currentTpm = usage.tpm ?? 0;
		// PY: always select by TPM low-water-mark
		if (currentTpm < bestTpmUsage) {
			bestTpmUsage = currentTpm;
			best = dep;
		}
	}

	return best;
}

/**
 * Latency-based routing.
 *
 * Picks the deployment with the lowest average latency.
 * Falls back to simpleShuffle if no latency data available.
 * @param deployments
 * @param ctx
 */
/**
 * Cost-based routing.
 *
 * Picks the deployment with the lowest combined cost (input + output cost per token).
 * Falls back to simpleShuffle if no cost data is available for any deployment.
 * Aligns with PY LowestCostLoggingHandler + async_get_available_deployments.
 * PY checks TPM/RPM limits from Cache before cost comparison; TS checks in-memory.
 * @param deployments
 * @param ctx
 */
export function costBasedRouting(deployments: Deployment[], ctx: RoutingContext): Deployment | null {
	if (deployments.length === 0) {
		return null;
	}

	let bestCost = Infinity;
	// GAP 8: PY `LowestCostLoggingHandler` 在多 deployment 同 cost 时用 `random.choice` 随机选
	// (lowest_cost.py:282-290)。TS 之前用 `<` 严格小于仅保留第一个，导致同 cost 时永远选第一个。
	// 改为累积 bestCandidates，最后随机选一个；同时严格小于触发"重置 bestCandidates"。
	const bestCandidates: Deployment[] = [];

	for (const dep of deployments) {
		// PY: resolve TPM/RPM limits with 3-level fallback
		const tpmLimit = _getTpm(dep);
		const rpmLimit = _getRpm(dep);
		const usage = ctx.tpmRpmLimiter.getUsage(deploymentKey(dep));

		// PY: projected TPM check: item_tpm + input_tokens > _deployment_tpm (strict >)
		// PY: item_rpm + 1 > _deployment_rpm (strict > with 1-slot buffer)
		const projectedTpm = usage.tpm + (ctx.estimatedInputTokens ?? 0);
		if (tpmLimit !== undefined && projectedTpm > tpmLimit) {
			continue;
		}
		if (rpmLimit !== undefined && usage.rpm + 1 > rpmLimit) {
			continue;
		}

		// GAP 8: PY `LowestCostLoggingHandler.async_get_available_deployments`
		//   始终查全局 `litellm.model_cost` 表（lowest_cost.py:264-289），无 user 提供的
		//   `model_cost_map` 概念。PY 用户若需自定义，应直接修改 `litellm.model_cost` 全局表。
		// TS 对齐策略：
		//   1. litellm_params.input_cost_per_token / output_cost_per_token（部署级覆盖）
		//   2. lookupModelCostPerToken(model)（PY 等价的内置全局表）
		//   3. ctx.modelCostMap（TS 增强：作为 RouterConfig.model_cost_map 用户覆盖内置表的方式，
		//      语义等价于 PY 修改 litellm.model_cost）
		//   4. $5.0 / $5.0 缺省（与 PY 对齐 lowest_cost.py:283, 288）
		// PY does NOT check model_info for cost data; uses litellm_params.model as lookup key
		const params = dep.litellm_params;
		let inputCost: number | undefined;
		let outputCost: number | undefined;

		if (params.input_cost_per_token !== undefined) {
			inputCost = params.input_cost_per_token;
		}
		if (params.output_cost_per_token !== undefined) {
			outputCost = params.output_cost_per_token;
		}

		const modelName = params.model;
		// 显式 RouterConfig.model_cost_map 优先；未命中时读取当前服务快照。
		const snapshotCost =
			inputCost === undefined || outputCost === undefined ? lookupModelCostPerToken(modelName, ctx.modelCostMap) : undefined;
		if (inputCost === undefined) {
			inputCost = snapshotCost?.input_cost_per_token;
		}
		if (outputCost === undefined) {
			outputCost = snapshotCost?.output_cost_per_token;
		}

		// TS 增强：用户 model_cost_map 覆盖（语义等价 PY 修改 litellm.model_cost）

		// 最后回退到 $5.0 缺省（与 PY 一致）
		if (inputCost === undefined) {
			inputCost = 5.0;
		}
		if (outputCost === undefined) {
			outputCost = 5.0;
		}

		const totalCost = inputCost + outputCost;

		if (totalCost < bestCost) {
			bestCost = totalCost;
			bestCandidates.length = 0;
			bestCandidates.push(dep);
		} else if (totalCost === bestCost) {
			bestCandidates.push(dep);
		}
	}

	// PY: random.choice 在 cost 相同的 candidates 中随机
	if (bestCandidates.length > 0) {
		return bestCandidates[Math.floor(Math.random() * bestCandidates.length)] ?? null;
	}
	// PY: if no deployment passed limits, return None -> caller throws RouterRateLimitError
	return null;
}

/**
 * @param deployments
 * @param ctx
 */
export function usageBasedRoutingV2(deployments: Deployment[], ctx: RoutingContext): Deployment | null {
	if (deployments.length === 0) {
		return null;
	}

	// First pass: filter out deployments at hard TPM/RPM limit
	// PY: uses projected TPM check: item_tpm + input_tokens > _deployment_tpm
	// PY: uses rpm_dict[item] + 1 >= _deployment_rpm (with 1-slot buffer)
	const candidates: Deployment[] = [];
	for (const dep of deployments) {
		const tpmLimit = _getTpm(dep);
		const rpmLimit = _getRpm(dep);
		const usage = ctx.tpmRpmLimiter.getUsage(deploymentKey(dep));

		// Hard limit check: projected TPM
		const projectedTpm = usage.tpm + (ctx.estimatedInputTokens ?? 0);
		if (tpmLimit !== undefined && projectedTpm > tpmLimit) {
			continue;
		}
		// Hard limit check: RPM with 1-slot buffer
		if (rpmLimit !== undefined && usage.rpm + 1 >= rpmLimit) {
			continue;
		}

		candidates.push(dep);
	}

	if (candidates.length === 0) {
		return null;
	}

	// Second pass: pick the deployment with the lowest TPM usage (aligns with PY LowestTPMLoggingHandler_v2)
	// PY _return_potential_deployments: picks by item_tpm, no limit-based branching
	let lowestTpm = Infinity;
	const bestCandidates: Deployment[] = [];

	for (const dep of candidates) {
		const usage = ctx.tpmRpmLimiter.getUsage(deploymentKey(dep));

		// PY: always compare by TPM, no RPM fallback
		if (usage.tpm < lowestTpm) {
			lowestTpm = usage.tpm;
			bestCandidates.length = 0;
			bestCandidates.push(dep);
		} else if (usage.tpm === lowestTpm) {
			bestCandidates.push(dep);
		}
	}

	// Random selection among lowest-TPM candidates (PY behavior: random.choice)
	if (bestCandidates.length === 0) {
		// GAP: PY `lowest_tpm_rpm_v2.py:441-442` 在 bestCandidates 为空时直接 return None，无 simpleShuffle fallback
		// TS 之前 fallback 到 simpleShuffle；现改为与 PY 一致返回 null
		return null;
	}

	// GAP 9: PY `LowestTPMLoggingHandler_v2.async_pre_call_check` 用 Redis INCR
	//   `check-then-act` 原子化 (lowest_tpm_rpm_v2.py:141-225)。TS 在单进程下用
	//   `tryReserveSync` 在 pick 后立即占据 RPM slot，避免并发请求都通过非原子的 filter+pick
	//   后才发现 limit 已耗尽。多进程部署仍依赖架构层（Redis 等）。
	// DIFF-010: 当所有 candidate 的 tryReserveSync 都失败时，回滚此前已成功 reserve 的 slot。
	//   PY 在 atomic 路径下走 group rollback（lowest_tpm_rpm_v2.async_pre_call_check 用
	//   pipeline INCR/DECR 配对），TS 端通过 rollbackReservation 手动配对释放。
	if (ctx.tpmRpmLimiter.tryReserveSync) {
		// 在随机候选顺序里依次尝试 reserve，第一个成功的即返回
		const shuffled = [...bestCandidates].sort(() => Math.random() - 0.5);
		// DIFF-010: 记录失败 reserve 的部署名，用于失败时 rollback
		// （正常路径下应当无失败 reserve；保险起见跟踪）
		for (const dep of shuffled) {
			const tpmLimit = _getTpm(dep);
			const rpmLimit = _getRpm(dep);
			if (ctx.tpmRpmLimiter.tryReserveSync(deploymentKey(dep), tpmLimit, rpmLimit, ctx.estimatedInputTokens ?? 0)) {
				return dep;
			}
		}
		// DIFF-010: group 内全部 candidate reserve 均失败 → 表明 first-pass filter 后
		//   并发请求耗尽了 RPM；当前并未成功占用任何 slot（tryReserveSync 失败时不 push），
		//   所以无需 rollback。返回 null 让 caller 走 fallback chain。
		return null;
	}

	// 无 tryReserveSync 能力时退化为单纯随机选（与历史行为一致）
	return bestCandidates[Math.floor(Math.random() * bestCandidates.length)] ?? null;
}

/**
 * Latency-based routing.
 *
 * Picks the deployment with the lowest average latency.
 * Prior to latency comparison, filters out TPM/RPM-limited deployments
 * (aligning with PY LowestLatencyLoggingHandler.get_available_deployments).
 * Falls back to simpleShuffle if no latency data available.
 * For streaming requests, uses TTFT (time to first token) when available,
 * aligning with PY LowestLatencyLoggingHandler which prefers TTFT for streaming.
 * @param deployments
 * @param ctx
 */
export function latencyBasedRouting(deployments: Deployment[], ctx: RoutingContext): Deployment | null {
	if (deployments.length === 0) {
		return null;
	}

	// PY: filter out rate-limited deployments first (get_available_deployments)
	// PY: uses projected TPM check and RPM with 1-slot buffer
	const available = deployments.filter((dep) => {
		const tpmLimit = _getTpm(dep);
		const rpmLimit = _getRpm(dep);
		const usage = ctx.tpmRpmLimiter.getUsage(deploymentKey(dep));
		const projectedTpm = usage.tpm + (ctx.estimatedInputTokens ?? 0);
		if (tpmLimit !== undefined && projectedTpm > tpmLimit) {
			return false;
		}
		if (rpmLimit !== undefined && usage.rpm + 1 > rpmLimit) {
			return false;
		}
		return true;
	});

	if (available.length === 0) {
		return null;
	}

	// PY: shuffle before iterating (低延迟路由随机打乱避免负载倾斜)
	// PY random.sample(list(_items), len(_items)) = Fisher-Yates 完整排列
	// 旧实现 `[...].sort(() => Math.random() - 0.5)` 不是 Fisher-Yates（不均匀分布）
	const shuffled = fisherYatesShuffle(available);

	// PY: for streaming requests, prefer TTFT over total latency. TTFT tracks time-to-first-token
	// which is more representative of current congestion than total response time.
	// PY checks request_kwargs.get("stream") is True to decide — use the isStream flag passed via RoutingContext.
	const useTtft = ctx.isStream === true;

	const latencyGetter = (dep: Deployment): number => {
		if (useTtft && ctx.ttft) {
			const t = ctx.ttft.get(deploymentKey(dep));
			if (t !== undefined && t > 0) {
				return t;
			}
		}
		return ctx.latencies.get(deploymentKey(dep)) ?? Infinity;
	};

	// Check if any latency data exists in the selected source
	const hasLatencyData = shuffled.some((dep) => {
		const latency = latencyGetter(dep);
		return latency !== undefined && latency !== Infinity && latency > 0;
	});

	if (!hasLatencyData) {
		// No latency data yet, fall back to shuffle
		return simpleShuffle(shuffled, ctx);
	}

	// PY: 先找出最低延迟
	let lowestLatency = Infinity;
	for (const dep of shuffled) {
		const latency = latencyGetter(dep);
		if (latency < lowestLatency) {
			lowestLatency = latency;
		}
	}

	// 从任一部署获取 lowest_latency_buffer 配置
	let buffer = 0;
	for (const dep of shuffled) {
		const b = dep.litellm_params.lowest_latency_buffer;
		if (b !== undefined && b > 0) {
			buffer = b;
			break;
		}
	}

	// PY: buffer is proportional: lowest_latency_buffer * lowest_latency
	const threshold = lowestLatency + (buffer > 0 ? buffer * lowestLatency : 0);

	// PY: 收集在 threshold 阈值内的候选，随机选择（而非仅取最低）
	const candidates = shuffled.filter((dep) => {
		const latency = latencyGetter(dep);
		return latency <= threshold;
	});

	if (candidates.length > 0) {
		return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
	}

	return null;
}

/**
 * Fisher-Yates 完整排列 shuffle（对齐 PY random.sample）
 * @template T
 * @param items
 * @returns shuffled copy of items
 */
function fisherYatesShuffle<T>(items: T[]): T[] {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const tmp = result[i] as T;
		result[i] = result[j] as T;
		result[j] = tmp;
	}
	return result;
}
