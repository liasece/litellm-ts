/** 单个逻辑模型位置的 alias 解析轨迹。 */
export interface ModelResolutionChainEntry {
	/**
	 *
	 */
	readonly fallback_index: number;
	/**
	 *
	 */
	readonly input_model: string;
	/**
	 *
	 */
	readonly resolved_model: string;
	/**
	 *
	 */
	readonly resolution_path: readonly string[];
}

/** 触发一次跨模型 fallback 的错误摘要。 */
export interface RoutingTraceErrorInformation {
	/** Error class or name. */
	readonly error_type: string;
	/** Provider or HTTP error code, when available. */
	readonly error_code: string | number | null;
	/** Original error message. */
	readonly error_message: string;
}

/** 请求从一个逻辑模型 fallback 到另一个逻辑模型的单跳决策。 */
export interface RoutingTraceEntry {
	/** 目标模型在 fallback_models 中的位置，首个 fallback 为 1。 */
	readonly fallback_index: number;
	/** Fallback 前的逻辑模型。 */
	readonly from_model: string;
	/** Fallback 配置中的目标模型（可能是 alias）。 */
	readonly to_model: string;
	/** Alias 展开后的目标模型。 */
	readonly to_resolved_model: string;
	/** 目标模型的完整 alias 展开路径。 */
	readonly resolution_path: readonly string[];
	/** 命中的 fallback 配置类型。 */
	readonly routing_type: "general_fallback" | "context_window_fallback" | "content_policy_fallback";
	/** 触发本跳 fallback 的规范原因。 */
	readonly reason: "no_available_deployment" | "rate_limit" | "context_window_exceeded" | "content_policy_violation" | "upstream_error";
	/** 本跳失败的实际 deployment。 */
	readonly attempted_deployment?: string;
	/** 触发本跳 fallback 的错误摘要。 */
	readonly error_information: RoutingTraceErrorInformation;
}

/** FallbackHandler 返回的单次结构化解析结果。 */
export interface ModelGroupResolution {
	/**
	 *
	 */
	readonly inputModel: string;
	/**
	 *
	 */
	readonly resolvedModel: string;
	/**
	 *
	 */
	readonly resolutionPath: readonly string[];
}

/** 请求级可变轨迹容器，由 endpoint 持有以覆盖成功和失败日志。 */
export interface ModelResolutionTraceCollector {
	/**
	 *
	 */
	readonly entries: ModelResolutionChainEntry[];
	/**
	 *
	 */
	fallbackDepth: number;
	/**
	 *
	 */
	readonly fallbackModels: string[];
	/** 真正发生的跨模型 fallback 决策，按执行顺序记录。 */
	readonly routingTrace: RoutingTraceEntry[];
}

/**
 *
 */
export function createModelResolutionTraceCollector(): ModelResolutionTraceCollector {
	return { entries: [], fallbackDepth: 0, fallbackModels: [], routingTrace: [] };
}

function readErrorCode(error: Error): string | number | null {
	const candidate = error as Error & { statusCode?: unknown; status?: unknown; code?: unknown };
	for (const value of [candidate.statusCode, candidate.status, candidate.code]) {
		if (typeof value === "string" || typeof value === "number") {
			return value;
		}
	}
	return null;
}

function inferRoutingReason(error: Error): RoutingTraceEntry["reason"] {
	const normalized = `${error.name} ${error.message}`.toLowerCase();
	if (normalized.includes("context window") || normalized.includes("contextwindow")) {
		return "context_window_exceeded";
	}
	if (normalized.includes("content policy") || normalized.includes("contentpolicy")) {
		return "content_policy_violation";
	}
	if (normalized.includes("rate limit") || normalized.includes("ratelimit") || readErrorCode(error) === 429) {
		return "rate_limit";
	}
	if (normalized.includes("no available deployment") || normalized.includes("no deployments available")) {
		return "no_available_deployment";
	}
	return "upstream_error";
}

/**
 * 记录一次实际发生的 fallback 决策，并把错误限制为适合日志展示的结构化摘要。
 * @param collector - 请求级轨迹容器
 * @param input - 本次 fallback 的路由和错误
 */
export function appendRoutingTrace(
	collector: ModelResolutionTraceCollector | undefined,
	input: {
		fromModel: string;
		toResolution: ModelGroupResolution;
		routingType: RoutingTraceEntry["routing_type"];
		error: Error;
		reason?: RoutingTraceEntry["reason"];
		attemptedDeployment?: string;
	},
): void {
	if (!collector) {
		return;
	}
	const fallbackIndex = collector.routingTrace.length + 1;
	collector.routingTrace.push({
		fallback_index: fallbackIndex,
		from_model: input.fromModel,
		to_model: input.toResolution.inputModel,
		to_resolved_model: input.toResolution.resolvedModel,
		resolution_path: [...input.toResolution.resolutionPath],
		routing_type: input.routingType,
		reason: input.reason ?? inferRoutingReason(input.error),
		...(input.attemptedDeployment ? { attempted_deployment: input.attemptedDeployment } : {}),
		error_information: {
			error_type: input.error.name || "Error",
			error_code: readErrorCode(input.error),
			error_message: input.error.message.slice(0, 8_000),
		},
	});
}

/**
 * 仅记录真正发生 alias 展开的路径；同 fallback 位置、同 path 去重。
 * @param collector
 * @param fallbackIndex
 * @param resolution
 */
export function appendModelResolutionTrace(
	collector: ModelResolutionTraceCollector | undefined,
	fallbackIndex: number,
	resolution: ModelGroupResolution,
): void {
	if (!collector) {
		return;
	}
	collector.fallbackDepth = Math.max(collector.fallbackDepth, fallbackIndex);
	if (collector.fallbackModels[fallbackIndex] === undefined) {
		collector.fallbackModels[fallbackIndex] = fallbackIndex === 0 ? resolution.inputModel : resolution.resolvedModel;
	}
	if (resolution.resolutionPath.length <= 1) {
		return;
	}
	const path = [...resolution.resolutionPath];
	const duplicate = collector.entries.some(
		(entry) =>
			entry.fallback_index === fallbackIndex &&
			entry.resolution_path.length === path.length &&
			entry.resolution_path.every((node, index) => node === path[index]),
	);
	if (duplicate) {
		return;
	}
	collector.entries.push({
		fallback_index: fallbackIndex,
		input_model: resolution.inputModel,
		resolved_model: resolution.resolvedModel,
		resolution_path: path,
	});
}

/**
 * @param collector
 */
export function copyModelResolutionChain(collector: ModelResolutionTraceCollector | undefined): ModelResolutionChainEntry[] | undefined {
	if (!collector || collector.entries.length === 0) {
		return undefined;
	}
	return collector.entries.map((entry) => ({ ...entry, resolution_path: [...entry.resolution_path] }));
}

/**
 * 返回可安全写入 SpendLogs 的 fallback 决策快照。
 * @param collector - 请求级轨迹容器
 */
export function copyRoutingTrace(collector: ModelResolutionTraceCollector | undefined): RoutingTraceEntry[] | undefined {
	if (!collector || collector.routingTrace.length === 0) {
		return undefined;
	}
	return collector.routingTrace.map((entry) => ({
		...entry,
		resolution_path: [...entry.resolution_path],
		error_information: { ...entry.error_information },
	}));
}

/**
 * 在 Router 最终失败时把请求级轨迹挂到错误对象上。属性不可枚举，避免进入客户端错误响应，
 * 但 endpoint 仍可用 getResultModelResolutionMetadata 读取并写入 SpendLogs。
 * @param error - Router 最终抛出的错误
 * @param collector - 请求级轨迹容器
 */
export function attachModelResolutionMetadataToError(error: unknown, collector: ModelResolutionTraceCollector): void {
	if ((typeof error !== "object" && typeof error !== "function") || error === null) {
		return;
	}
	const metadata = {
		_fallbackModels: [...collector.fallbackModels],
		_modelResolutionChain: copyModelResolutionChain(collector),
		_routingTrace: copyRoutingTrace(collector),
	};
	for (const [key, value] of Object.entries(metadata)) {
		Object.defineProperty(error, key, { configurable: true, value: value, writable: true });
	}
}

/**
 * 从 Router 成功结果中提取可安全写入 SpendLogs 的解析元数据。
 * @param result - Router 成功结果或附带非枚举轨迹的错误
 */
export function getResultModelResolutionMetadata(result: Record<string, unknown>): {
	fallbackModels?: string[];
	modelResolutionChain?: ModelResolutionChainEntry[];
	routingTrace?: RoutingTraceEntry[];
	attemptedRetries?: number;
} {
	const fallbackModels = Array.isArray(result["_fallbackModels"])
		? result["_fallbackModels"].filter((model): model is string => typeof model === "string")
		: undefined;
	const rawChain = result["_modelResolutionChain"];
	const modelResolutionChain = Array.isArray(rawChain)
		? rawChain.flatMap((entry) => {
				if (typeof entry !== "object" || entry === null) {
					return [];
				}
				const value = entry as Partial<ModelResolutionChainEntry>;
				if (
					typeof value.fallback_index !== "number" ||
					typeof value.input_model !== "string" ||
					typeof value.resolved_model !== "string" ||
					!Array.isArray(value.resolution_path) ||
					!value.resolution_path.every((node) => typeof node === "string")
				) {
					return [];
				}
				return [
					{
						fallback_index: value.fallback_index,
						input_model: value.input_model,
						resolved_model: value.resolved_model,
						resolution_path: [...value.resolution_path],
					},
				];
			})
		: undefined;
	const rawRoutingTrace = result["_routingTrace"];
	const routingTrace = normalizeRoutingTrace(rawRoutingTrace);
	return {
		fallbackModels: fallbackModels,
		modelResolutionChain: modelResolutionChain,
		...(routingTrace.length > 0 ? { routingTrace: routingTrace } : {}),
		attemptedRetries: fallbackModels ? Math.max(fallbackModels.length - 1, 0) : undefined,
	};
}

/**
 * 防御性解析来自 Router 结果或持久化 metadata 的 routing_trace。
 * @param value - 未验证的 trace 值
 */
export function normalizeRoutingTrace(value: unknown): RoutingTraceEntry[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((raw) => {
		if (typeof raw !== "object" || raw === null) {
			return [];
		}
		const entry = raw as Partial<RoutingTraceEntry>;
		const error = entry.error_information as Partial<RoutingTraceErrorInformation> | undefined;
		if (
			!Number.isInteger(entry.fallback_index) ||
			(entry.fallback_index ?? -1) < 1 ||
			typeof entry.from_model !== "string" ||
			typeof entry.to_model !== "string" ||
			typeof entry.to_resolved_model !== "string" ||
			!Array.isArray(entry.resolution_path) ||
			!entry.resolution_path.every((node) => typeof node === "string") ||
			!(["general_fallback", "context_window_fallback", "content_policy_fallback"] as const).includes(
				entry.routing_type as RoutingTraceEntry["routing_type"],
			) ||
			!(
				["no_available_deployment", "rate_limit", "context_window_exceeded", "content_policy_violation", "upstream_error"] as const
			).includes(entry.reason as RoutingTraceEntry["reason"]) ||
			!error ||
			typeof error.error_type !== "string" ||
			!(typeof error.error_code === "string" || typeof error.error_code === "number" || error.error_code === null) ||
			typeof error.error_message !== "string"
		) {
			return [];
		}
		return [
			{
				...(entry as RoutingTraceEntry),
				resolution_path: [...entry.resolution_path],
				error_information: {
					error_type: error.error_type,
					error_code: error.error_code,
					error_message: error.error_message,
				},
			},
		];
	});
}
