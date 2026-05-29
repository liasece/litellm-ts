/**
 * Routing Strategy Implementations
 *
 * Strategies for selecting the best deployment for a request.
 * Each function receives a list of deployments and routing context,
 * and returns the selected deployment or null if none available.
 */

import type { Deployment } from "../types/router";
import { lookupModelCostPerToken } from "../cost/CostCalculator";

/** Named routing strategies */
export type RoutingStrategyName =
	| "simple-shuffle"
	| "least-busy"
	| "usage-based-routing"
	| "latency-based-routing"
	| "cost-based-routing"
	| "usage-based-routing-v2";

/** Context provided to routing strategies */
export interface RoutingContext {
	/** All available deployments */
	deployments: Deployment[];
	/** TPM/RPM usage query (returns usage within current window) */
	tpmRpmLimiter: { getUsage(name: string): { tpm: number; rpm: number } };
	/** Active request counts per deployment key */
	activeRequests: Map<string, number>;
	/** Average latency per deployment key (ms) */
	latencies: Map<string, number>;
	/** Estimated input tokens for the request (for usage-based pre-check) */
	estimatedInputTokens?: number;
	/** TTFT (time to first token) per deployment key (ms), used by latencyBasedRouting for streaming requests */
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
	let fieldName: "weight" | "rpm" | "tpm" | null = null;
	for (const f of ["weight", "rpm", "tpm"] as const) {
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
		if (fieldName === "weight") {
			weight = params.weight ?? 0;
		} else if (fieldName === "rpm") {
			weight = params.rpm ?? 0;
		} else if (fieldName === "tpm") {
			weight = params.tpm ?? 0;
		}
		candidates.push({ deployment: dep, weight: weight });
	}

	// Weighted random selection
	// PY uses random.choices (weighted pick) which handles zero-weight gracefully
	const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
	if (totalWeight === 0) {
		// All weights are zero — fall back to uniform random
		return deployments[Math.floor(Math.random() * deployments.length)] ?? null;
	}
	let random = Math.random() * totalWeight;

	for (const candidate of candidates) {
		random -= candidate.weight;
		if (random <= 0) {
			return candidate.deployment;
		}
	}

	return candidates[candidates.length - 1]!.deployment;
}

/**
 * Least-busy routing.
 *
 * Picks the deployment with the fewest active in-flight requests.
 * PY: fallback to random choice when no best found (cache empty case).
 * @param deployments
 * @param ctx
 */
export function leastBusy(deployments: Deployment[], ctx: RoutingContext): Deployment | null {
	if (deployments.length === 0) {
		return null;
	}

	let best: Deployment | null = null;
	let minActive = Infinity;

	for (const dep of deployments) {
		const active = ctx.activeRequests.get(deploymentKey(dep)) ?? 0;
		if (active < minActive) {
			minActive = active;
			best = dep;
		}
	}

	// PY: fallback to random choice when no best found
	if (best === null && deployments.length > 0) {
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

		// PY: always select by TPM low-water-mark
		if (usage.tpm < bestTpmUsage) {
			bestTpmUsage = usage.tpm;
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

	let best: Deployment | null = null;
	let bestCost = Infinity;

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

		// PY chain: litellm_params.input_cost_per_token -> model_cost[litellm_params.model] -> $5/$5 per-field fallback
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

		// PY: fallback to model_cost map using litellm_params.model as key
		const modelName = params.model;
		const userGlobalCost = ctx.modelCostMap?.[modelName];

		if (inputCost === undefined) {
			inputCost = userGlobalCost?.input_cost_per_token;
		}
		if (outputCost === undefined) {
			outputCost = userGlobalCost?.output_cost_per_token;
		}

		// PY: second fallback to built-in model_cost table (litellm.model_cost is always populated)
		const builtinCost = inputCost === undefined || outputCost === undefined ? lookupModelCostPerToken(modelName) : undefined;

		if (inputCost === undefined) {
			inputCost = builtinCost?.input_cost_per_token ?? 5.0;
		}
		if (outputCost === undefined) {
			outputCost = builtinCost?.output_cost_per_token ?? 5.0;
		}

		const totalCost = inputCost + outputCost;

		if (totalCost < bestCost) {
			bestCost = totalCost;
			best = dep;
		}
	}

	// PY: if no deployment passed limits, return None -> caller throws RouterRateLimitError
	return best ?? null;
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
	if (bestCandidates.length > 0) {
		return bestCandidates[Math.floor(Math.random() * bestCandidates.length)] ?? null;
	}

	return simpleShuffle(candidates, ctx);
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
	const shuffled = [...available].sort(() => Math.random() - 0.5);

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
