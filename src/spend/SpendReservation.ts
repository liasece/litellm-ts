/**
 * Endpoint Spend reservation orchestration.
 *
 * Uses Router read-only views to conservatively estimate every reachable deployment,
 * then owns one request-local lease heartbeat until the endpoint settles/releases it.
 */

import type { Request } from "express";
import { lookupModelCostPerToken, type CustomCostPerToken } from "../cost/CostCalculator";
import { ApiError } from "../core/api/ApiError";
import type { DrizzleDb } from "../core/db/Database";
import { getModelGroupName } from "../router/RouterModelGroupCache";
import { extractDeploymentCustomCost } from "../router/RouterSpendInfo";
import type { Deployment } from "../types/router";
import { CallType } from "../types/spend";
import {
	buildSpendReservationScopes,
	estimateSpendReservation,
	getOrCreateSpendRequestId,
	registerActiveRequest,
	removeActiveRequest,
	reserveSpend,
	startActiveRequestHeartbeat,
	startSpendReservationHeartbeat,
	type SpendReservationHeartbeat,
} from "./SpendTracker";

/** Router 估算只依赖的只读接口。 */
export interface SpendReservationRouterView {
	/**
	 *
	 */
	getDeployments(): Deployment[];
	/**
	 *
	 */
	getFallbacks(): Record<string, string[]>;
}

/** Endpoint 成功预留后的请求级状态。 */
export interface EndpointSpendReservation {
	/**
	 *
	 */
	readonly requestId: string;
	/**
	 *
	 */
	readonly heartbeat?: SpendReservationHeartbeat;
}

/** 请求级 Provider/账务终结器；同一请求的成功、失败、断连只能提交一次。 */
export interface EndpointSpendLifecycle {
	/** 标记即将调用 Provider，并同步暴露此前 heartbeat 失败。 */
	markProviderStarted(): void;
	/** 幂等执行唯一终结动作；并发调用共享同一 Promise。 */
	finalize(action: () => Promise<void>): Promise<void>;
	/** 是否已开始执行终结动作，包括账务动作失败的情况。 */
	isFinalized(): boolean;
	/** 停止 heartbeat；可重复调用。 */
	stop(): void;
}

function combineSpendHeartbeats(...heartbeats: SpendReservationHeartbeat[]): SpendReservationHeartbeat {
	return {
		markProviderStarted: (): void => {
			for (const heartbeat of heartbeats) {
				heartbeat.markProviderStarted();
			}
		},
		renewNow: async (): Promise<boolean> => {
			const results = await Promise.all(heartbeats.map((heartbeat) => heartbeat.renewNow()));
			return results.every(Boolean);
		},
		stop: (): void => {
			for (const heartbeat of heartbeats) {
				heartbeat.stop();
			}
		},
	};
}

/**
 * 生产 Drizzle 实例始终具备这些能力。部分 endpoint 单元测试传入只覆盖旧 SpendLog
 * 查询面的轻量适配器；这类适配器不支持 ActiveRequests 时跳过实时列表登记，
 * 但仍保留原有 reservation / SpendLog 测试路径。
 */
function supportsActiveRequestTracking(db: DrizzleDb): boolean {
	const candidate = db as unknown as Record<string, unknown>;
	return (
		typeof candidate["transaction"] === "function" &&
		typeof candidate["select"] === "function" &&
		typeof candidate["insert"] === "function" &&
		typeof candidate["delete"] === "function" &&
		typeof candidate["update"] === "function"
	);
}

/**
 * 创建请求级幂等生命周期，统一 heartbeat 与唯一账务终结动作。
 * @param reservation - endpoint spend reservation
 */
export function createEndpointSpendLifecycle(reservation: EndpointSpendReservation | undefined): EndpointSpendLifecycle {
	let finalized: Promise<void> | undefined;
	let stopped = false;
	const stop = (): void => {
		if (stopped) {
			return;
		}
		stopped = true;
		reservation?.heartbeat?.stop();
	};
	return {
		markProviderStarted: (): void => reservation?.heartbeat?.markProviderStarted(),
		finalize: (action: () => Promise<void>): Promise<void> => {
			finalized ??= Promise.resolve().then(action).finally(stop);
			return finalized;
		},
		isFinalized: (): boolean => finalized !== undefined,
		stop: stop,
	};
}

function fallbackTargets(fallbacks: Record<string, string[]>, model: string): string[] {
	const strippedModel = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
	return fallbacks[model] ?? fallbacks[strippedModel] ?? fallbacks["*"] ?? [];
}

function collectReachableModelGroups(model: string, fallbacks: Record<string, string[]>): Set<string> {
	const groups = new Set<string>();
	const pending = [model];
	while (pending.length > 0) {
		const current = pending.shift()!;
		if (groups.has(current)) {
			continue;
		}
		groups.add(current);
		for (const fallback of fallbackTargets(fallbacks, current)) {
			if (!groups.has(fallback)) {
				pending.push(fallback);
			}
		}
	}
	return groups;
}

function conservativeDeploymentCost(deployment: Deployment): CustomCostPerToken {
	const deploymentModel = deployment.litellm_params.model;
	const custom = extractDeploymentCustomCost(deployment);
	const modelPrice = lookupModelCostPerToken(deploymentModel);
	const inputPrice = custom?.input_cost_per_token ?? modelPrice?.input_cost_per_token;
	const outputPrice = custom?.output_cost_per_token ?? modelPrice?.output_cost_per_token;
	if (inputPrice === undefined || outputPrice === undefined) {
		throw ApiError.unavailable(`deployment 模型价格不完整: ${deploymentModel}`);
	}
	const conservativeInputPrice = Math.max(
		inputPrice,
		custom?.cache_creation_input_token_cost ?? inputPrice,
		custom?.cache_read_input_token_cost ?? inputPrice,
	);
	return {
		input_cost_per_token: conservativeInputPrice,
		output_cost_per_token: outputPrice,
		cache_creation_input_token_cost: conservativeInputPrice,
		cache_read_input_token_cost: conservativeInputPrice,
	};
}

/**
 * 递归覆盖原模型组及 fallback 候选，按每个 deployment 的实际 model/custom cost 估算并取最大值。
 * 无法精确匹配模型组时，保守纳入 Router 的全部 deployments。
 * @param router
 * @param model
 * @param requestBody
 * @throws {ApiError} 当没有 deployment、价格不完整或费用无法估算时
 */
export function estimateRouterSpendReservation(
	router: SpendReservationRouterView,
	model: string,
	requestBody: Record<string, unknown>,
): number {
	const deployments = router.getDeployments();
	if (deployments.length === 0) {
		throw ApiError.unavailable(`没有可用于费用预留的 deployment: ${model}`);
	}
	const reachableGroups = collectReachableModelGroups(model, router.getFallbacks());
	const reachable = deployments.filter((deployment) => reachableGroups.has(getModelGroupName(deployment)));
	const other = deployments.filter((deployment) => !reachableGroups.has(getModelGroupName(deployment)));
	// Router 的公共读取接口不暴露 context-window/content-policy fallback；全部 deployment
	// 都必须纳入上界，普通/wildcard fallback 只用于稳定地优先计算已知可达候选。
	const candidates = [...reachable, ...other];
	let maximum = 0;
	for (const deployment of candidates) {
		const deploymentModel = deployment.litellm_params.model;
		const estimate = estimateSpendReservation(deploymentModel, requestBody, conservativeDeploymentCost(deployment));
		if (!Number.isFinite(estimate) || estimate < 0) {
			throw ApiError.unavailable(`deployment 模型费用无法估算: ${deploymentModel}`);
		}
		maximum = Math.max(maximum, estimate);
	}
	return maximum;
}

/**
 * 为 endpoint 创建 reservation，并在成功后立即启动请求级 heartbeat。
 * @param db
 * @param router
 * @param req
 * @param model
 * @param requestBody
 * @param optionsOrCostMode
 */
export async function reserveEndpointSpend(
	db: DrizzleDb | undefined,
	router: SpendReservationRouterView,
	req: Request,
	model: string,
	requestBody: Record<string, unknown>,
	optionsOrCostMode:
		| "token"
		| "image"
		| "audio"
		| { costMode?: "token" | "image" | "audio"; callType?: CallType; startTime?: Date } = {},
): Promise<EndpointSpendReservation | undefined> {
	if (!db || !req.auth) {
		return undefined;
	}
	const options = typeof optionsOrCostMode === "string" ? { costMode: optionsOrCostMode } : optionsOrCostMode;
	const costMode = options.costMode ?? "token";
	const requestId = getOrCreateSpendRequestId(req);
	const scopes = buildSpendReservationScopes(req.auth);
	const activeRequestTrackingSupported = supportsActiveRequestTracking(db);
	const register = async (): Promise<SpendReservationHeartbeat | undefined> => {
		if (!activeRequestTrackingSupported) {
			return undefined;
		}
		await registerActiveRequest(db, {
			req: req,
			requestId: requestId,
			model: model,
			callType: options.callType ?? CallType.ACompletion,
			startTime: options.startTime,
		});
		return startActiveRequestHeartbeat(db, requestId);
	};
	if (scopes.length === 0) {
		return { requestId: requestId, heartbeat: await register() };
	}
	if (costMode !== "token") {
		throw ApiError.unavailable(`${costMode} endpoint 的实际费用无法由 token CostCalculator 可靠上界估算`);
	}
	const reserved = estimateRouterSpendReservation(router, model, requestBody);
	const activeHeartbeat = await register();
	try {
		const reservation = await reserveSpend(db, { requestId: requestId, reserved: reserved, scopes: scopes });
		if (reservation.status === "duplicate") {
			throw ApiError.conflict(`重复的 request_id: ${requestId}`);
		}
		return {
			requestId: requestId,
			heartbeat: combineSpendHeartbeats(
				startSpendReservationHeartbeat(db, requestId),
				...(activeHeartbeat === undefined ? [] : [activeHeartbeat]),
			),
		};
	} catch (error) {
		activeHeartbeat?.stop();
		if (activeRequestTrackingSupported) {
			await removeActiveRequest(db, requestId).catch(() => undefined);
		}
		throw error;
	}
}
