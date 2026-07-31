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
}

/**
 *
 */
export function createModelResolutionTraceCollector(): ModelResolutionTraceCollector {
	return { entries: [], fallbackDepth: 0, fallbackModels: [] };
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

/** 从 Router 成功结果中提取可安全写入 SpendLogs 的解析元数据。 */
export function getResultModelResolutionMetadata(result: Record<string, unknown>): {
	fallbackModels?: string[];
	modelResolutionChain?: ModelResolutionChainEntry[];
	attemptedRetries?: number;
} {
	const fallbackModels = Array.isArray(result["_fallbackModels"])
		? result["_fallbackModels"].filter((model): model is string => typeof model === "string")
		: undefined;
	const rawChain = result["_modelResolutionChain"];
	const modelResolutionChain = Array.isArray(rawChain)
		? rawChain.flatMap((entry) => {
				if (typeof entry !== "object" || entry === null) return [];
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
	return {
		fallbackModels,
		modelResolutionChain,
		attemptedRetries: fallbackModels ? Math.max(fallbackModels.length - 1, 0) : undefined,
	};
}
