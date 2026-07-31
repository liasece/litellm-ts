/**
 * LiteLLM Router — 主类。
 * 持有 deployments / cooldown / tpmRpmLimiter / fallbackHandler / providerRegistry；
 * 对外暴露 completion / acompletion / getAvailableDeployment；
 * 内部 _executeWithFallback 主循环委托给 RouterExecution.executeWithFallback。
 *
 * DIFF-T18: 7 个内部 helper（shouldRetryThisError / timeToSleepBeforeRetry / ...）
 * 抽到 RouterTestDelegates.ts；Router.ts 只保留公共 API 与 execute 主循环编排。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";
import type {
	Deployment,
	RouterConfig,
	RouterModelGroupAliasValue,
	RouterCallbacks,
	RetryPolicy,
	AllowedFailsPolicy,
	CredentialValuesAccessor,
	LitellmParams,
} from "../types/router";
import type { ProviderConfig as ProviderConfigType } from "../types/provider";
import { ProviderRegistry } from "../providers/ProviderRegistry";
import { CooldownManager } from "./CooldownManager";
import { TPMRPMLimiter } from "./TPMRPMLimiter";
import { FallbackHandler } from "./FallbackHandler";
import { RedisCooldownBackend } from "./RedisCooldownBackend";
import { extractProviderHeaders } from "./RouterResponseHeaders";
import { buildStreamWithTtft } from "./RouterStreamWrapper";
import {
	simpleShuffle,
	leastBusy,
	usageBasedRouting,
	latencyBasedRouting,
	costBasedRouting,
	usageBasedRoutingV2,
} from "./RoutingStrategies";
import type { RoutingContext } from "./RoutingStrategies";
import { logger } from "../core/utils/logger";
import { RouterCompletionSyncRemovedError } from "./RouterErrors";
import { getDeploymentKey, getModelGroupName } from "./RouterModelGroupCache";
import { buildCooldownDecision } from "./RouterExecutor";
import type { NoDeploymentsErrorInfo } from "../core/api/ApiError";
import { ApiError } from "../core/api/ApiError";
import { normalizeMockTestingParams, tryDispatchMockTestingExceptions, shouldDispatchMockRateLimit } from "./RouterMockTesting";
import { executeWithFallback, isKnownModel, type RouterExecContext } from "./RouterExecution";
import { createModelResolutionTraceCollector, type ModelGroupResolution, type ModelResolutionTraceCollector } from "./ModelResolutionTrace";
import { RoutingStrategyName } from "../types/router";
import { executeProviderRequest } from "./ProviderRequestExecutor";

type RouteFn = (deployments: Deployment[], ctx: RoutingContext) => Deployment | null;

interface Message {
	role: string;
	content: string | null;
}

interface ExecResult {
	response: Response;
	body: unknown;
	ttft: number;
	stream?: AsyncGenerator<unknown>;
	/** 实际执行上游完整 URL（provider.transformRequest 产出），spend log api_base 用 */
	upstreamUrl: string;
}

interface AvailDeployment {
	deployment: Deployment;
	provider: ProviderConfigType;
}

/**
 * 单次 HTTP 请求使用的数据库配置快照。
 * 该对象只在 AsyncLocalStorage 请求上下文内存活，不是跨请求缓存。
 */
export interface RouterRuntimeSnapshot {
	/** 当前可路由的部署列表。 */
	readonly deployments: Deployment[];
	/** 当前请求使用的 fallback 处理器。 */
	readonly fallbackHandler: FallbackHandler;
	/** 当前请求使用的部署选择函数。 */
	readonly routeFn: RouteFn;
	/** 默认冷却时长（毫秒）。 */
	readonly cooldownTimeMs: number;
	/** 默认重试次数。 */
	readonly numRetries: number;
	/** 全局重试策略。 */
	readonly retryPolicy: RetryPolicy | undefined;
	/** 按模型组覆盖的重试策略。 */
	readonly modelGroupRetryPolicy: Record<string, RetryPolicy> | undefined;
	/** 最大 fallback 次数。 */
	readonly maxFallbacks: number;
	/** 是否启用调用前检查。 */
	readonly preCallChecks: boolean;
	/** 可选调用前检查开关。 */
	readonly optionalPreCallChecks: Record<string, boolean> | undefined;
	/** 默认重试等待时间。 */
	readonly retryAfter: number;
	/** Router 级允许失败次数。 */
	readonly allowedFails: number | AllowedFailsPolicy | null;
	/** 当前请求使用的凭证读取器。 */
	readonly credentialValues: CredentialValuesAccessor | undefined;
}

/** 精确 deployment ID 不存在。 */
export class DeploymentNotFoundError extends Error {
	constructor(readonly modelId: string) {
		super(`Deployment not found: ${modelId}`);
		this.name = "DeploymentNotFoundError";
	}
}

/** 单个 deployment 的主动健康探测结果。 */
export interface DeploymentProbeResult {
	/**
	 *
	 */
	readonly model_id: string;
	/**
	 *
	 */
	readonly model_name: string;
	/**
	 *
	 */
	readonly status: "healthy" | "unhealthy";
	/**
	 *
	 */
	readonly checked_at: string;
	/**
	 *
	 */
	readonly latency_ms: number;
	/**
	 *
	 */
	readonly error?: string;
}

const STRATEGY_MAP: Record<string, RouteFn> = {
	[RoutingStrategyName.SimpleShuffle]: simpleShuffle,
	[RoutingStrategyName.LeastBusy]: leastBusy,
	[RoutingStrategyName.UsageBasedRouting]: usageBasedRouting,
	[RoutingStrategyName.LatencyBasedRouting]: latencyBasedRouting,
	[RoutingStrategyName.CostBasedRouting]: costBasedRouting,
	[RoutingStrategyName.UsageBasedRoutingV2]: usageBasedRoutingV2,
};

const RECENT_LATENCY_COUNT = 10;
const CHARS_PER_TOKEN = 3.5;
const ESTIMATED_TOKENS_OVERHEAD = 10;
const FAILURE_LATENCY_PENALTY_SEC = 1000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_FALLBACKS = 5;
/**
 * `completionSync` 已废弃，保留参数签名仅为兼容。
 * 该常量是历史默认超时（毫秒），保留为常量是为了避免在签名里出现裸魔法数。
 */
const DEFAULT_COMPLETION_SYNC_TIMEOUT_MS = 60_000;

/**
 * LiteLLM Router 入口。
 * 持有 model_list 派发 + fallback chain + cooldown + TPM/RPM 限流等状态；
 * 公共 API：getDeployments / getAvailableDeployment / completion / acompletion / completionSync。
 */
export class Router {
	private readonly _runtimeSnapshots = new AsyncLocalStorage<RouterRuntimeSnapshot>();
	private readonly _deployments: Deployment[];
	private readonly _cooldownManager: CooldownManager;
	private readonly _tpmRpmLimiter: TPMRPMLimiter;
	private readonly _fallbackHandler: FallbackHandler;
	private readonly _providerRegistry: ProviderRegistry;
	private _routeFn: RouteFn;
	private _cooldownTimeMs: number;
	private _numRetries: number;
	private readonly _modelGroupAlias: Record<string, RouterModelGroupAliasValue>;
	private readonly _disableCooldowns: boolean;
	private readonly _contextWindowFallbacks: Record<string, string[]>;
	private readonly _contentPolicyFallbacks: Record<string, string[]>;
	private readonly _retryPolicy;
	private _modelGroupRetryPolicy;
	private _maxFallbacks: number;
	private _preCallChecks: boolean;
	private readonly _optionalPreCallChecks: Record<string, boolean> | undefined;
	private _retryAfter: number;
	private _allowedFails: number | AllowedFailsPolicy | null;
	private readonly _modelCostMap: Record<string, { input_cost_per_token: number; output_cost_per_token: number }> | undefined;
	private readonly _routerCallbacks: RouterCallbacks | undefined;
	private readonly _credentialValues: CredentialValuesAccessor | undefined;

	private readonly _activeRequests: Map<string, number> = new Map();
	private readonly _latencies: Map<string, number> = new Map();
	private readonly _previousModels: Map<string, number[]> = new Map();
	private readonly _totalCalls: Map<string, number> = new Map();
	private readonly _successCalls: Map<string, number> = new Map();
	private readonly _failCalls: Map<string, number> = new Map();
	private readonly _ttft: Map<string, number> = new Map();
	private readonly _latencySamples: Map<string, number[]> = new Map();

	constructor(
		config: RouterConfig,
		modelGroupAlias?: Record<string, RouterModelGroupAliasValue>,
		credentialValues?: CredentialValuesAccessor,
	) {
		this._deployments = [...config.model_list];
		this._credentialValues = credentialValues;
		this._cooldownTimeMs = (config.cooldown_time != null && config.cooldown_time > 0 ? config.cooldown_time : 5) * 1000;
		// PY router.py:497-502：`if num_retries is not None: self.num_retries = num_retries`——
		// 显式传 0 表示不重试（0 次），仅缺省（undefined/null）才回退 DEFAULT_MAX_RETRIES。
		this._numRetries = config.num_retries ?? DEFAULT_MAX_RETRIES;
		this._modelGroupAlias = modelGroupAlias ?? config.model_group_alias ?? {};
		this._disableCooldowns = config.disable_cooldowns ?? false;
		this._contextWindowFallbacks = config.context_window_fallbacks ?? {};
		this._contentPolicyFallbacks = config.content_policy_fallbacks ?? {};
		this._retryPolicy = config.retry_policy;
		this._modelGroupRetryPolicy = config.model_group_retry_policy;
		this._maxFallbacks = config.max_fallbacks != null && config.max_fallbacks > 0 ? config.max_fallbacks : DEFAULT_MAX_FALLBACKS;
		this._preCallChecks = config.pre_call_checks ?? false;
		this._optionalPreCallChecks = config.optional_pre_call_checks;
		this._retryAfter = config.retry_after ?? 0;
		this._allowedFails = config.allowed_fails ?? null;
		this._modelCostMap = config.model_cost_map;
		this._routerCallbacks = config.router_callbacks;

		const providerDefaultDeploymentIds: string[] = [];
		for (const dep of config.model_list) {
			if (dep.model_info?.id && dep.model_info?.mode === "default") {
				providerDefaultDeploymentIds.push(dep.model_info.id);
			}
		}
		this._cooldownManager = new CooldownManager(
			this._disableCooldowns,
			config.allowed_fails,
			providerDefaultDeploymentIds,
			this._cooldownTimeMs,
			config.redis_cooldown_client ? new RedisCooldownBackend(config.redis_cooldown_client) : undefined,
			config.cooldown_callbacks,
		);
		this._tpmRpmLimiter = new TPMRPMLimiter();
		this._providerRegistry = new ProviderRegistry();

		const mergedFallbacks: Record<string, string[]> = {};
		for (const fb of config.fallbacks ?? []) {
			for (const [key, vals] of Object.entries(fb)) {
				if (!(key in mergedFallbacks)) {
					mergedFallbacks[key] = vals;
				}
			}
		}
		if (config.default_fallbacks && config.default_fallbacks.length > 0) {
			mergedFallbacks["*"] = config.default_fallbacks;
		}
		this._fallbackHandler = new FallbackHandler(
			mergedFallbacks,
			this._modelGroupAlias,
			this._contextWindowFallbacks,
			this._contentPolicyFallbacks,
		);

		this._routeFn = this._selectStrategy(config.routing_strategy);
	}

	/** 返回 Router 持有的 deployments 列表的拷贝 */
	getDeployments(): Deployment[] {
		return [...this._runtimeState().deployments];
	}

	/** 当前可供管理端选择的逻辑模型名与 alias key，不暴露 provider model 或 deployment id。 */
	getAvailableModelNames(): Array<{ model_name: string; type: "model" | "alias"; mode: string }> {
		const names = new Map<string, { type: "model" | "alias"; mode: string }>();
		const runtime = this._runtimeState();
		for (const deployment of runtime.deployments) {
			if (deployment.model_name) {
				names.set(deployment.model_name, { type: "model", mode: deployment.model_info?.mode ?? "chat" });
			}
		}
		for (const alias of runtime.fallbackHandler.getModelGroupAliasKeys()) {
			const resolvedModel = runtime.fallbackHandler.resolveModelGroup(alias);
			const target = runtime.deployments.find((deployment) => this._matchDeploymentPattern(deployment, resolvedModel));
			if (target) {
				names.set(alias, { type: "alias", mode: target.model_info?.mode ?? "chat" });
			}
		}
		return [...names.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([model_name, candidate]) => ({ model_name: model_name, type: candidate.type, mode: candidate.mode }));
	}

	/**
	 * 读取当前 fallback 配置（对齐 PY Router.fallbacks 运行时值），
	 * 供 /v2/model/info 按 model_group 反查展示（PY get_all_fallbacks 等价数据源）。
	 * 运行时经 updateSettings 热更新后反映最新值。
	 */
	getFallbacks(): Record<string, string[]> {
		return this._runtimeState().fallbackHandler.getFallbacks();
	}

	/**
	 * 按 model_info.id 查找 deployment（对齐 PY Router.get_deployment）。
	 * @param modelId - deployment model_info.id
	 */
	getDeployment(modelId: string): Deployment | null {
		return this._runtimeState().deployments.find((dep) => dep.model_info?.id === modelId) ?? null;
	}

	/**
	 * 返回逻辑模型（含 alias）最终可解析到的 deployment ID。
	 * 健康检查使用精确 ID 探测，因此这里不受 cooldown 状态影响。
	 * @param model - 模型组或 alias
	 */
	getDeploymentIdsForModel(model: string): string[] {
		const runtime = this._runtimeState();
		const resolvedModel = runtime.fallbackHandler.resolveModelGroup(model);
		return runtime.deployments
			.filter((deployment) => this._matchDeploymentPattern(deployment, resolvedModel))
			.map((deployment) => deployment.model_info?.id)
			.filter((id): id is string => typeof id === "string" && id.length > 0);
	}

	/**
	 * 按 model_info.id 精确探测一个 deployment，不经过路由、重试、fallback 或 cooldown。
	 * @param modelId - deployment model_info.id
	 */
	async probeDeployment(modelId: string): Promise<DeploymentProbeResult> {
		let deployment = this.getDeployment(modelId);
		if (deployment === null) {
			throw new DeploymentNotFoundError(modelId);
		}
		deployment = this._resolveDeploymentForExecution(deployment);

		const checkedAt = new Date().toISOString();
		const startedAt = Date.now();
		const mode = deployment.model_info?.mode ?? "chat";
		if (mode !== "chat" && mode !== "completion" && mode !== "embedding") {
			return {
				model_id: modelId,
				model_name: deployment.model_name,
				status: "unhealthy",
				checked_at: checkedAt,
				latency_ms: 0,
				error: `Unsupported health check mode: ${mode}`,
			};
		}

		try {
			const provider = this._providerRegistry.getProvider(
				deployment.litellm_params.model,
				deployment.litellm_params.custom_llm_provider,
				deployment.litellm_params,
			);
			const mergedParams: Record<string, unknown> = { ...deployment.litellm_params, stream: false };
			const providerRequest =
				mode === "embedding"
					? provider.transformEmbeddingRequest?.(deployment.litellm_params.model, "health-check", mergedParams)
					: provider.transformRequest(deployment.litellm_params.model, [{ role: "user", content: "health-check" }], mergedParams);
			if (providerRequest === undefined) {
				return {
					model_id: modelId,
					model_name: deployment.model_name,
					status: "unhealthy",
					checked_at: checkedAt,
					latency_ms: Date.now() - startedAt,
					error: `Provider does not support ${mode} health checks`,
				};
			}
			const requestWithHeaders = {
				...providerRequest,
				headers: { ...providerRequest.headers, ...deployment.litellm_params.extra_headers },
			};
			const configuredTimeout = deployment.litellm_params["health_check_timeout"] ?? deployment.litellm_params.timeout;
			const timeoutSec = typeof configuredTimeout === "number" && configuredTimeout > 0 ? configuredTimeout : 10;
			const execution = await executeProviderRequest(requestWithHeaders, { timeoutMs: timeoutSec * 1000, readJson: false });
			if (!execution.response.ok) {
				return {
					model_id: modelId,
					model_name: deployment.model_name,
					status: "unhealthy",
					checked_at: checkedAt,
					latency_ms: execution.latencyMs,
					error: `Provider returned HTTP ${execution.response.status}`,
				};
			}
			return {
				model_id: modelId,
				model_name: deployment.model_name,
				status: "healthy",
				checked_at: checkedAt,
				latency_ms: execution.latencyMs,
			};
		} catch (error) {
			const errorName = error instanceof Error ? error.name : "Error";
			const isTimeout = error instanceof Error && error.name === "TimeoutError";
			const safeMessage = isTimeout ? "Health check timed out" : `Health check failed: ${errorName}`;
			return {
				model_id: modelId,
				model_name: deployment.model_name,
				status: "unhealthy",
				checked_at: checkedAt,
				latency_ms: Date.now() - startedAt,
				error: safeMessage,
			};
		}
	}

	/**
	 * 新增 deployment（对齐 PY Router.add_deployment）。
	 * 同 model_info.id 已存在时的替换语义请用 upsertDeployment。
	 * @param deployment - 待新增 deployment
	 */
	addDeployment(deployment: Deployment): void {
		this._deployments.push(deployment);
	}

	/**
	 * 新增或按 model_info.id 替换 deployment（对齐 PY Router.upsert_deployment）：
	 * 同 id 且 litellm_params 相同 → no-op；同 id 参数不同 → 替换；无同 id → 追加。
	 * @param deployment - 待 upsert 的 deployment（model_info.id 为匹配键）
	 * @returns 是否发生了新增/替换
	 */
	upsertDeployment(deployment: Deployment): boolean {
		const modelId = deployment.model_info?.id;
		if (modelId) {
			const existingIdx = this._deployments.findIndex((dep) => dep.model_info?.id === modelId);
			if (existingIdx >= 0) {
				const existing = this._deployments[existingIdx]!;
				if (isDeepStrictEqual(existing, deployment)) {
					return false;
				}
				this._deployments.splice(existingIdx, 1);
			}
		}
		this._deployments.push(deployment);
		return true;
	}

	/**
	 * 按 model_info.id 移除 deployment（对齐 PY Router.delete_deployment）。
	 * @param modelId - deployment model_info.id
	 * @returns 是否找到并移除
	 */
	removeDeployment(modelId: string): boolean {
		const existingIdx = this._deployments.findIndex((dep) => dep.model_info?.id === modelId);
		if (existingIdx < 0) {
			return false;
		}
		this._deployments.splice(existingIdx, 1);
		return true;
	}

	/**
	 * 运行时更新 router 设置（对齐 PY Router.update_settings，router.py:8491-8540）。
	 * 白名单内才生效；fallbacks / context_window_fallbacks / model_group_alias 委托
	 * FallbackHandler（链缓存随之失效）；allowed_fails 委托 CooldownManager；
	 * 整型设置（timeout/num_retries/retry_after/allowed_fails/cooldown_time）按 PY 做 int 转换。
	 * routing_strategy_args / timeout / max_retries 在白名单内但 TS 无运行时消费方，跳过；
	 * 非白名单键忽略（PY 仅 debug 日志）。
	 * @param settings - snake_case 设置键值（router_settings 段）
	 * @throws 未知 routing_strategy 名称（对齐 PY routing_strategy_init 失败）
	 */
	updateSettings(settings: Record<string, unknown>): void {
		for (const [key, value] of Object.entries(settings)) {
			if (value === undefined || value === null) {
				continue;
			}
			switch (key) {
				case "fallbacks":
					this._fallbackHandler.setFallbacks(value as Array<Record<string, string[]>> | Record<string, string[]>);
					break;
				case "context_window_fallbacks":
					this._fallbackHandler.setContextWindowFallbacks(value as Record<string, string[]>);
					break;
				case "model_group_alias":
					this._fallbackHandler.setModelGroupAlias(value as Record<string, RouterModelGroupAliasValue>);
					break;
				case "routing_strategy":
					this._routeFn = this._selectStrategy(String(value));
					break;
				case "num_retries":
					this._numRetries = Router._castIntSetting(key, value) ?? this._numRetries;
					break;
				case "cooldown_time": {
					const cooldownSec = Router._castIntSetting(key, value);
					if (cooldownSec !== null) {
						this._cooldownTimeMs = cooldownSec * 1000;
					}
					break;
				}
				case "retry_after":
					this._retryAfter = Router._castIntSetting(key, value) ?? this._retryAfter;
					break;
				case "allowed_fails": {
					// number（PY _int_settings int 转换）或 AllowedFailsPolicy 分类阈值对象
					if (typeof value === "object") {
						this._allowedFails = value as AllowedFailsPolicy;
						this._cooldownManager.setAllowedFails(this._allowedFails);
					} else {
						const allowedFails = Router._castIntSetting(key, value);
						if (allowedFails !== null) {
							this._allowedFails = allowedFails;
							this._cooldownManager.setAllowedFails(this._allowedFails);
						}
					}
					break;
				}
				case "model_group_retry_policy":
					this._modelGroupRetryPolicy = value as Record<string, RetryPolicy>;
					break;
				case "max_fallbacks": {
					const maxFb = Router._castIntSetting(key, value);
					if (maxFb !== null && maxFb > 0) {
						this._maxFallbacks = maxFb;
					}
					break;
				}
				case "enable_pre_call_checks":
					this._preCallChecks = Boolean(value);
					break;
				case "routing_strategy_args":
				case "timeout":
				case "max_retries":
					// PY 白名单内；TS Router 无对应运行时字段（超时走 deployment.litellm_params），跳过
					break;
				default:
					logger.debug(`Router.updateSettings: 忽略非白名单设置 ${key}`);
			}
		}
	}

	/**
	 * PY update_settings 的 _int_settings 转换：int(kwargs[var])。
	 * @param key - 设置名（日志用）
	 * @param value - 原始值
	 * @returns 转换后的整数；不可转换时返回 null（调用方保留原值）
	 */
	private static _castIntSetting(key: string, value: unknown): number | null {
		const num = Number(value);
		if (!Number.isFinite(num)) {
			logger.debug(`Router.updateSettings: ${key} 无法转换为整数，忽略`, { value: value });
			return null;
		}
		return Math.trunc(num);
	}

	private _selectStrategy(name: string): RouteFn {
		const fn = STRATEGY_MAP[name];
		if (fn) {
			return fn;
		}
		throw new Error(`Unknown routing strategy: "${name}". Valid strategies: ${Object.keys(STRATEGY_MAP).join(", ")}`);
	}

	/**
	 * 从数据库查询结果构造请求级运行时快照。所有可变配置均从传入 settings
	 * 重新计算，避免继承上一请求或管理写路径留下的进程内状态。
	 * @param deployments
	 * @param settings
	 * @param credentialValues
	 */
	createRuntimeSnapshot(
		deployments: Deployment[],
		settings: Record<string, unknown>,
		credentialValues?: CredentialValuesAccessor,
	): RouterRuntimeSnapshot {
		const mergedFallbacks: Record<string, string[]> = {};
		const configuredFallbacks = settings["fallbacks"];
		if (Array.isArray(configuredFallbacks)) {
			for (const entry of configuredFallbacks) {
				if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
					continue;
				}
				for (const [model, targets] of Object.entries(entry)) {
					if (!(model in mergedFallbacks) && Array.isArray(targets)) {
						mergedFallbacks[model] = targets.filter((target): target is string => typeof target === "string");
					}
				}
			}
		} else if (typeof configuredFallbacks === "object" && configuredFallbacks !== null) {
			for (const [model, targets] of Object.entries(configuredFallbacks)) {
				if (Array.isArray(targets)) {
					mergedFallbacks[model] = targets.filter((target): target is string => typeof target === "string");
				}
			}
		}
		const defaultFallbacks = settings["default_fallbacks"];
		if (Array.isArray(defaultFallbacks)) {
			mergedFallbacks["*"] = defaultFallbacks.filter((target): target is string => typeof target === "string");
		}

		const aliases =
			typeof settings["model_group_alias"] === "object" &&
			settings["model_group_alias"] !== null &&
			!Array.isArray(settings["model_group_alias"])
				? (settings["model_group_alias"] as Record<string, RouterModelGroupAliasValue>)
				: {};
		const contextWindowFallbacks =
			typeof settings["context_window_fallbacks"] === "object" &&
			settings["context_window_fallbacks"] !== null &&
			!Array.isArray(settings["context_window_fallbacks"])
				? (settings["context_window_fallbacks"] as Record<string, string[]>)
				: {};
		const contentPolicyFallbacks =
			typeof settings["content_policy_fallbacks"] === "object" &&
			settings["content_policy_fallbacks"] !== null &&
			!Array.isArray(settings["content_policy_fallbacks"])
				? (settings["content_policy_fallbacks"] as Record<string, string[]>)
				: {};
		const routingStrategy =
			typeof settings["routing_strategy"] === "string" ? settings["routing_strategy"] : RoutingStrategyName.LatencyBasedRouting;
		const numRetries = Router._castIntSetting("num_retries", settings["num_retries"]) ?? DEFAULT_MAX_RETRIES;
		const cooldownSeconds = Router._castIntSetting("cooldown_time", settings["cooldown_time"]);
		const retryAfter = Router._castIntSetting("retry_after", settings["retry_after"]) ?? 0;
		const maxFallbacks = Router._castIntSetting("max_fallbacks", settings["max_fallbacks"]);
		const allowedFailsValue = settings["allowed_fails"];
		const allowedFails =
			typeof allowedFailsValue === "object" && allowedFailsValue !== null
				? (allowedFailsValue as AllowedFailsPolicy)
				: Router._castIntSetting("allowed_fails", allowedFailsValue);
		const retryPolicy =
			typeof settings["retry_policy"] === "object" && settings["retry_policy"] !== null
				? (settings["retry_policy"] as RetryPolicy)
				: undefined;
		const modelGroupRetryPolicy =
			typeof settings["model_group_retry_policy"] === "object" && settings["model_group_retry_policy"] !== null
				? (settings["model_group_retry_policy"] as Record<string, RetryPolicy>)
				: undefined;
		const optionalPreCallChecks =
			typeof settings["optional_pre_call_checks"] === "object" && settings["optional_pre_call_checks"] !== null
				? (settings["optional_pre_call_checks"] as Record<string, boolean>)
				: undefined;

		return {
			deployments: deployments.map((deployment) => ({
				...deployment,
				litellm_params: structuredClone(deployment.litellm_params),
				model_info: deployment.model_info === undefined ? undefined : structuredClone(deployment.model_info),
			})),
			fallbackHandler: new FallbackHandler(mergedFallbacks, aliases, contextWindowFallbacks, contentPolicyFallbacks),
			routeFn: this._selectStrategy(routingStrategy),
			cooldownTimeMs: (cooldownSeconds !== null && cooldownSeconds > 0 ? cooldownSeconds : 5) * 1000,
			numRetries: numRetries,
			retryPolicy: retryPolicy,
			modelGroupRetryPolicy: modelGroupRetryPolicy,
			maxFallbacks: maxFallbacks !== null && maxFallbacks > 0 ? maxFallbacks : DEFAULT_MAX_FALLBACKS,
			preCallChecks: Boolean(settings["enable_pre_call_checks"] ?? settings["pre_call_checks"] ?? false),
			optionalPreCallChecks: optionalPreCallChecks,
			retryAfter: retryAfter,
			allowedFails: allowedFails,
			credentialValues: credentialValues,
		};
	}

	/**
	 * 在请求级数据库快照中执行下游 Express 调用链。
	 * @param snapshot
	 * @param callback
	 */
	runWithRuntimeSnapshot<T>(snapshot: RouterRuntimeSnapshot, callback: () => T): T {
		return this._runtimeSnapshots.run(snapshot, callback);
	}

	private _runtimeState(): RouterRuntimeSnapshot {
		return (
			this._runtimeSnapshots.getStore() ?? {
				deployments: this._deployments,
				fallbackHandler: this._fallbackHandler,
				routeFn: this._routeFn,
				cooldownTimeMs: this._cooldownTimeMs,
				numRetries: this._numRetries,
				retryPolicy: this._retryPolicy,
				modelGroupRetryPolicy: this._modelGroupRetryPolicy,
				maxFallbacks: this._maxFallbacks,
				preCallChecks: this._preCallChecks,
				optionalPreCallChecks: this._optionalPreCallChecks,
				retryAfter: this._retryAfter,
				allowedFails: this._allowedFails,
				credentialValues: this._credentialValues,
			}
		);
	}

	private _estimateInputTokens(messages: Message[]): number {
		const inputTextLength = messages.reduce((sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0), 0);
		return Math.ceil(inputTextLength / CHARS_PER_TOKEN) + ESTIMATED_TOKENS_OVERHEAD;
	}

	private _buildRoutingContext(deployments: Deployment[], estimatedInputTokens?: number): RoutingContext {
		return {
			deployments: deployments,
			tpmRpmLimiter: {
				getUsage: (name: string) => this._tpmRpmLimiter.getUsage(name),
				tryReserveSync: (name: string, tpmLimit?: number, rpmLimit?: number, estimatedInputTokens?: number): boolean =>
					this._tpmRpmLimiter.tryReserveSync(name, tpmLimit, rpmLimit, estimatedInputTokens),
				rollbackReservation: (name: string): boolean => this._tpmRpmLimiter.rollbackReservation(name),
			},
			activeRequests: this._activeRequests,
			latencies: this._latencies,
			estimatedInputTokens: estimatedInputTokens,
			ttft: this._ttft,
			modelCostMap: this._modelCostMap,
		};
	}

	private _getDeploymentsForModel(model: string): Deployment[] {
		const runtime = this._runtimeState();
		const resolved = runtime.fallbackHandler.resolveModelGroup(model);
		return runtime.deployments.filter(
			(dep) => this._matchDeploymentPattern(dep, resolved) && !this._cooldownManager.isInCooldown(getDeploymentKey(dep)),
		);
	}

	private _matchDeploymentPattern(dep: Deployment, model: string): boolean {
		if (dep.model_name === model) {
			return true;
		}
		const slashIdx = model.indexOf("/");
		if (slashIdx > 0 && slashIdx < model.length - 1) {
			const stripped = model.slice(slashIdx + 1);
			if (dep.model_name === stripped) {
				return true;
			}
			if (dep.model_name.includes("*")) {
				const prefix = dep.model_name.replace(/\*/g, "");
				if (stripped.startsWith(prefix) || model.startsWith(prefix)) {
					return true;
				}
			}
		}
		if (dep.model_name.includes("*")) {
			const prefix = dep.model_name.replace(/\*/g, "");
			if (model.startsWith(prefix)) {
				return true;
			}
		}
		return false;
	}

	private _getHealthyDeploymentsForGroup(model: string): Deployment[] {
		return this._runtimeState().deployments.filter(
			(d) => d.model_name === model && !this._cooldownManager.isInCooldown(getDeploymentKey(d)),
		);
	}

	/**
	 * 将 deployment 复制为仅供本次出站使用的已解析副本。运行期凭据优先于 inline 参数，
	 * 但引用名绝不传递给 provider；原 deployment 保持可供管理端展示的配置原样。
	 * @param deployment
	 * @throws Credential 引用无效或不存在时抛出脱敏配置错误。
	 */
	private _resolveDeploymentForExecution(deployment: Deployment): Deployment {
		const inlineParams = deployment.litellm_params;
		const credentialName = inlineParams["litellm_credential_name"];
		if (credentialName === undefined) {
			return { ...deployment, litellm_params: { ...inlineParams } };
		}
		if (credentialName === null || (typeof credentialName === "string" && credentialName.trim().length === 0)) {
			const resolvedParams = { ...inlineParams };
			delete resolvedParams["litellm_credential_name"];
			return { ...deployment, litellm_params: resolvedParams };
		}
		if (typeof credentialName !== "string") {
			throw new Error("Credential configuration is invalid");
		}
		const credentialValues = this._runtimeState().credentialValues?.getValues(credentialName);
		if (credentialValues === undefined) {
			throw new Error("Credential configuration is invalid");
		}
		const resolvedParams: Record<string, unknown> = { ...inlineParams, ...credentialValues };
		delete resolvedParams["litellm_credential_name"];
		return { ...deployment, litellm_params: resolvedParams as LitellmParams };
	}

	/**
	 * 选取一个可用 deployment 并附上其 provider 配置。messages 可选用于 token 估算
	 * @param model - 逻辑模型名（用户传入）
	 * @param messages - 可选消息列表（用于 token 估算）
	 */
	getAvailableDeployment(model: string, messages?: Message[]): AvailDeployment | null {
		const deployments = this._getDeploymentsForModel(model);
		if (deployments.length === 0) {
			return null;
		}
		const estimatedInputTokens = messages ? this._estimateInputTokens(messages) : undefined;
		const ctx = this._buildRoutingContext(deployments, estimatedInputTokens);
		const selected = this._runtimeState().routeFn(deployments, ctx);
		if (!selected) {
			return null;
		}
		const deployment = this._resolveDeploymentForExecution(selected);
		const provider = this._providerRegistry.getProvider(
			deployment.litellm_params.model,
			deployment.litellm_params.custom_llm_provider,
			deployment.litellm_params,
		);
		return { deployment: deployment, provider: provider };
	}

	private async _executeRequest(
		provider: ProviderConfigType,
		deployment: Deployment,
		messages: Message[],
		optionalParams: Record<string, unknown>,
	): Promise<ExecResult> {
		const callType = optionalParams["__litellm_call_type"];
		const requestParams = { ...optionalParams };
		delete requestParams["__litellm_call_type"];
		const mergedParams: Record<string, unknown> = { ...deployment.litellm_params, ...requestParams };
		const providerRequest =
			callType === "image_generation"
				? provider.transformImageRequest?.(
						deployment.litellm_params.model,
						typeof messages[0]?.content === "string" ? messages[0].content : "",
						mergedParams,
					)
				: provider.transformRequest(deployment.litellm_params.model, messages as Message[], mergedParams);
		if (!providerRequest) {
			// 抛结构化 ApiError 而非裸 Error：让 ImageEndpoint 返回合理的 4xx/5xx 而非通用 500。
			throw ApiError.unavailable(`Provider does not support image generation for model ${deployment.model_name}`);
		}

		const isStream = optionalParams["stream"] === true;
		const timeoutSec = isStream
			? (deployment.litellm_params.stream_timeout ?? deployment.litellm_params.timeout)
			: deployment.litellm_params.timeout;
		const execution = await executeProviderRequest(providerRequest, {
			timeoutMs: timeoutSec !== undefined ? timeoutSec * 1000 : undefined,
			readJson: !isStream,
		});
		const response = execution.response;

		if (isStream) {
			const { stream, body, ttft } = buildStreamWithTtft(response, execution.startedAtMs, provider);
			const providerHeaders = extractProviderHeaders(response);
			if (providerHeaders) {
				(response as Response & { _providerHeaders?: Record<string, string> })._providerHeaders = providerHeaders;
			}
			return { response: response, body: body, ttft: ttft, stream: stream, upstreamUrl: providerRequest.url };
		}

		const providerHeaders = extractProviderHeaders(response);
		if (providerHeaders) {
			(response as Response & { _providerHeaders?: Record<string, string> })._providerHeaders = providerHeaders;
		}
		return {
			response: response,
			body: execution.body,
			ttft: execution.latencyMs,
			upstreamUrl: providerRequest.url,
		};
	}

	private _buildExecContext(): RouterExecContext {
		const runtime = this._runtimeState();
		return {
			deployments: runtime.deployments,
			cooldownManager: this._cooldownManager,
			tpmRpmLimiter: this._tpmRpmLimiter,
			fallbackHandler: runtime.fallbackHandler,
			providerRegistry: this._providerRegistry,
			activeRequests: this._activeRequests,
			latencies: this._latencies,
			latencySamples: this._latencySamples,
			ttft: this._ttft,
			totalCalls: this._totalCalls,
			successCalls: this._successCalls,
			failCalls: this._failCalls,
			routerCallbacks: this._routerCallbacks,
			retryPolicy: runtime.retryPolicy,
			modelGroupRetryPolicy: runtime.modelGroupRetryPolicy,
			numRetries: runtime.numRetries,
			maxFallbacks: runtime.maxFallbacks,
			preCallChecks: runtime.preCallChecks,
			optionalPreCallChecks: runtime.optionalPreCallChecks,
			retryAfter: runtime.retryAfter,
			cooldownTimeMs: runtime.cooldownTimeMs,
			allowedFails: runtime.allowedFails,
			recentLatencyCount: RECENT_LATENCY_COUNT,
			failureLatencyPenaltySec: FAILURE_LATENCY_PENALTY_SEC,
		};
	}

	private _executeWithFallback(
		model: string,
		messages: Message[],
		optionalParams: Record<string, unknown>,
		fallbackDepth: number,
		previousError?: Error,
		modelResolutionTrace: ModelResolutionTraceCollector = createModelResolutionTraceCollector(),
	): Promise<Record<string, unknown>> {
		const ctx = this._buildExecContext();
		return executeWithFallback(
			ctx,
			{
				model: model,
				messages: messages,
				optionalParams: optionalParams,
				fallbackDepth: fallbackDepth,
				fallbackModels: [model],
				previousError: previousError,
				modelResolutionTrace: modelResolutionTrace,
			},
			{
				getCandidate: (m, msgs) => this.getAvailableDeployment(m, msgs),
				estimateInputTokens: (msgs) => this._estimateInputTokens(msgs),
				executeRequest: (prov, dep, msgs, params) => this._executeRequest(prov, dep, msgs, params),
				matchDeploymentPattern: (dep, m) => this._matchDeploymentPattern(dep, m),
				getHealthyDeployments: (m) => this._getHealthyDeploymentsForGroup(m),
			},
		);
	}

	/**
	 * PY: completion(model, messages, **kwargs) 透传 kwargs
	 * @param model - 逻辑模型名
	 * @param messages - 消息列表
	 * @param optionalParams - 请求参数（含 stream/temperature/fallbacks/mock_testing_*）
	 * @param modelResolutionTrace
	 */
	async completion(
		model: string,
		messages: Message[],
		optionalParams: Record<string, unknown> = {},
		modelResolutionTrace: ModelResolutionTraceCollector = createModelResolutionTraceCollector(),
	): Promise<Record<string, unknown>> {
		optionalParams = normalizeMockTestingParams(optionalParams);
		if (Array.isArray(optionalParams["fallbacks"])) {
			const seen = new Set<string>();
			optionalParams["fallbacks"] = (optionalParams["fallbacks"] as string[]).filter((fb) => {
				if (seen.has(fb)) {
					return false;
				}
				seen.add(fb);
				return true;
			});
		}
		const rateLimitDispatch = shouldDispatchMockRateLimit(optionalParams, model);
		if (rateLimitDispatch.dispatch) {
			throw rateLimitDispatch.error;
		}
		const retryAttempt = optionalParams["retry"];
		if (typeof retryAttempt === "number" && retryAttempt > 0) {
			let previousForModel = this._previousModels.get(model);
			if (!previousForModel) {
				previousForModel = [];
				this._previousModels.set(model, previousForModel);
			}
			previousForModel.push(retryAttempt);
			logger.debug(`Retrying request with num_retries: ${retryAttempt}`);
		}
		const silentModel = optionalParams["silent_model"];
		if (typeof silentModel === "string" && silentModel.length > 0) {
			const realResult = await this._executeWithFallback(model, messages, optionalParams, 0, undefined, modelResolutionTrace);
			this._executeWithFallback(silentModel, messages, { ...optionalParams, isSilentCall: true }, 0).catch(() => {
				// silent_model 失败仅记录，不抛
			});
			return realResult;
		}
		return this._executeWithFallback(model, messages, optionalParams, 0, undefined, modelResolutionTrace);
	}

	/**
	 * 标准图片生成入口。复用 Router 的 deployment 选择、重试、fallback、cooldown
	 * 与响应元数据，但由 Provider 使用图片生成协议构造上游请求。
	 * @param model - 逻辑模型名
	 * @param prompt - 图片提示词
	 * @param optionalParams - 图片生成参数
	 */
	async imageGeneration(model: string, prompt: string, optionalParams: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
		return this.completion(model, [{ role: "user", content: prompt }], { ...optionalParams, __litellm_call_type: "image_generation" });
	}

	/**
	 * 同步 completion 已移除（饿死事件循环风险）。调用方请改用 `await router.completion(...)`。
	 * @param _model - 保留参数签名兼容
	 * @param _messages - 保留参数签名兼容
	 * @param _optionalParams - 保留参数签名兼容
	 * @param _timeoutMs - 保留参数签名兼容，缺省 DEFAULT_COMPLETION_SYNC_TIMEOUT_MS
	 * @throws {RouterCompletionSyncRemovedError} 总是抛出
	 */
	completionSync(
		_model: string,
		_messages: Message[],
		_optionalParams: Record<string, unknown> = {},
		_timeoutMs = DEFAULT_COMPLETION_SYNC_TIMEOUT_MS,
	): Record<string, unknown> {
		throw new RouterCompletionSyncRemovedError(
			"Router.completionSync 已移除（饿死事件循环风险）。请改用 `await router.completion(model, messages, params)` 异步调用。",
		);
	}

	/**
	 * 异步入口：mock_testing_* 钩子分发（与 completion 等价，但显式处理异步异常）
	 * @param model - 逻辑模型名
	 * @param messages - 消息列表
	 * @param optionalParams - 请求参数
	 */
	async acompletion(model: string, messages: Message[], optionalParams: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
		optionalParams = normalizeMockTestingParams(optionalParams);
		try {
			tryDispatchMockTestingExceptions(optionalParams, model, this._runtimeState().fallbackHandler);
		} catch (mockErr) {
			return this._executeWithFallback(model, messages, optionalParams, 0, mockErr as Error);
		}
		return this.completion(model, messages, optionalParams);
	}

	/**
	 * 把 deployment 标记为冷却（供 test/外部调用）
	 * @param modelName - deployment model_name
	 */
	markFailed(modelName: string): void {
		this._cooldownManager.markFailed(modelName, this._runtimeState().cooldownTimeMs);
	}

	/**
	 * 直连端点（Anthropic Messages 手工 fetch 路径）单 deployment 调用成功后登记：
	 * 清除冷却 + 连续失败计数清零。与 RouterExecution 成功路径同一套 CooldownManager
	 * 调用（clearCooldown + recordSuccess），端侧不得自造重复逻辑。
	 * @param deployment - 成功的 deployment（来自 getAvailableDeployment）
	 */
	recordDeploymentSuccess(deployment: Deployment): void {
		const depKey = getDeploymentKey(deployment);
		this._cooldownManager.clearCooldown(depKey);
		this._cooldownManager.recordSuccess(depKey);
	}

	/**
	 * 直连端点单 deployment 调用失败后登记冷却：
	 * 复用 RouterExecution 失败路径的 buildCooldownDecision 判定（status code 白名单 /
	 * same-group / allowed_fails），命中时 markFailed + recordFailure。
	 * 冷却时长缺省取 router.cooldown_time（对齐 PY `_set_cooldown_deployments` 的
	 * `time_to_cooldown or self.cooldown_time`；RouterExecution 主循环同位置同样传
	 * cooldownTimeMs，两条冷却路径一致）。
	 * 是否真正冷却由 CooldownManager 决定（APIConnectionError 豁免、400 非冷却目标等），
	 * 调用方随后应沿 fallback 链重试下一 deployment。
	 * @param deployment - 失败的 deployment（来自 getAvailableDeployment）
	 * @param error - provider 返回的错误或网络错误
	 */
	recordDeploymentFailure(deployment: Deployment, error: Error): void {
		const runtime = this._runtimeState();
		const depKey = getDeploymentKey(deployment);
		const targetGroup = getModelGroupName(deployment);
		const sameGroupCount = runtime.deployments.filter((d) => getModelGroupName(d) === targetGroup).length;
		const decision = buildCooldownDecision({
			deployment: deployment,
			error: error,
			sameGroupCount: sameGroupCount,
			retryAfterHeader: undefined,
			defaultCooldownTimeMs: runtime.cooldownTimeMs,
			cooldownManager: this._cooldownManager,
			routerAllowedFails: runtime.allowedFails,
		});
		if (decision.shouldCooldown) {
			this._cooldownManager.markFailed(depKey, decision.cooldownDurationMs, decision.statusCode, error.message);
			this._cooldownManager.recordFailure(depKey);
		}
	}

	/**
	 * 解析逻辑模型并返回完整 alias 路径。
	 * @param model - 原始模型名
	 */
	resolveModelGroupWithTrace(model: string): ModelGroupResolution {
		return this._runtimeState().fallbackHandler.resolveModelGroupWithTrace(model);
	}

	/**
	 * @param model
	 * @param fallbackDepth
	 */
	getNextFallbackWithTrace(model: string, fallbackDepth: number): ModelGroupResolution | null {
		return this._runtimeState().fallbackHandler.getNextFallbackWithTrace(model, fallbackDepth);
	}

	/**
	 * @param model
	 * @param fallbackDepth
	 */
	getNextFallback(model: string, fallbackDepth: number): string | null {
		return this._runtimeState().fallbackHandler.getNextFallback(model, fallbackDepth);
	}

	/** fallback 链最大跳数上限（max_fallbacks 配置，防环型配置死循环） */
	get maxFallbacks(): number {
		return this._runtimeState().maxFallbacks;
	}

	/**
	 * 判断模型是否为已知模型（忽略冷却状态）。
	 * 对齐 PY route_llm_request 的 model 校验层（model_list / has_model_id /
	 * model_group_alias / deployment_names，litellm/proxy/route_llm_request.py:477-498）：
	 * 未知模型应返回 400（PY ProxyModelNotFoundError），已知但全部署冷却返回 429。
	 * 供端点层（AnthropicUpstreamDispatch 等）构造 400/429 响应。
	 * @param model - 客户端请求的逻辑模型名
	 */
	hasModel(model: string): boolean {
		const runtime = this._runtimeState();
		const resolved = runtime.fallbackHandler.resolveModelGroup(model);
		return isKnownModel(runtime.deployments, (dep, m) => this._matchDeploymentPattern(dep, m), resolved, model);
	}

	/**
	 * 返回模型组的冷却上下文，供端点构造 Python 风格 no-deployments 错误
	 * （对齐 PY router.py get_available_deployment 抛 RouterRateLimitError 的字段来源）：
	 * - cooldownSeconds：组内冷却 deployment 的最小配置 cooldown_time（PY get_min_cooldown 取
	 *   CooldownCacheValue.cooldown_time 配置时长而非剩余时间）；无冷却条目时为 Router 默认 cooldown_time
	 * - cooldownList：当前全部冷却中的 deployment id（PY cooldown_list 为全模型组范围，
	 *   见 cooldown_handlers.py _get_cooldown_deployments）
	 * - preCallChecks：Router pre_call_checks 开关
	 * @param model - 客户端请求的逻辑模型名
	 */
	getNoAvailableDeploymentInfo(model: string): NoDeploymentsErrorInfo {
		const runtime = this._runtimeState();
		const resolved = runtime.fallbackHandler.resolveModelGroup(model);
		const groupKeys = runtime.deployments
			.filter((dep) => this._matchDeploymentPattern(dep, resolved))
			.map((dep) => getDeploymentKey(dep));
		const allKeys = runtime.deployments.map((dep) => getDeploymentKey(dep));
		const groupCooldowns = this._cooldownManager.getActiveCooldowns(groupKeys);
		const allCooldowns = this._cooldownManager.getActiveCooldowns(allKeys);
		const cooldownMs =
			groupCooldowns.length > 0
				? Math.min(...groupCooldowns.map(([, cacheValue]) => cacheValue.cooldown_time))
				: runtime.cooldownTimeMs;
		return {
			cooldownSeconds: cooldownMs / 1000,
			cooldownList: allCooldowns.map(([deploymentKey]) => deploymentKey),
			preCallChecks: runtime.preCallChecks,
		};
	}

	/**
	 * 增减某 deployment 的活跃请求计数（外部/test 观察）
	 * @param modelName - deployment model_name
	 * @param delta - 增量（正/负）
	 */
	trackActiveRequest(modelName: string, delta: number): void {
		const current = this._activeRequests.get(modelName) ?? 0;
		this._activeRequests.set(modelName, Math.max(0, current + delta));
	}
}
