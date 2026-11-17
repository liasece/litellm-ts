import { modelRecord } from "../support/ModelModels";

/** One model's fallback entry, normalized from either wire form. */
export interface ModelFallbackEntry {
	/** Targets tried in order after the primary model fails. */
	targets: string[];
	/** Whether a failed target may continue along its own fallback entry. */
	recurse: boolean;
}

/**
 * Read the entry stored for one model group, or undefined when it has none.
 *
 * `router_settings.fallbacks` 在 PY 兼容形态下是「对象数组」，同名键先出现者生效，
 * 与后端合并规则一致，避免界面展示和实际路由读到不同条目。
 * @param routerSettings - router_settings 段
 * @param modelName - 模型组名
 */
export function modelFallbackEntry(routerSettings: unknown, modelName: string): ModelFallbackEntry | undefined {
	const fallbacks = modelRecord(routerSettings)["fallbacks"];
	if (!Array.isArray(fallbacks)) return undefined;
	for (const entry of fallbacks) {
		const record = modelRecord(entry);
		if (!Object.prototype.hasOwnProperty.call(record, modelName)) continue;
		return normalizeEntry(record[modelName]);
	}
	return undefined;
}

function normalizeEntry(value: unknown): ModelFallbackEntry {
	if (Array.isArray(value)) {
		return { targets: value.filter((item): item is string => typeof item === "string"), recurse: true };
	}
	const record = modelRecord(value);
	const targets = Array.isArray(record["targets"]) ? record["targets"].filter((item): item is string => typeof item === "string") : [];
	return { targets, recurse: record["recurse"] !== false };
}

/**
 * Replace only this model's chain, preserving peer entries and their routing order.
 *
 * `recurse: false` 写成对象形态，让目标成为叶子；为 true 时仍写数组，保持旧配置紧凑。
 * @param current - 当前 router_settings（或整个回调响应）
 * @param modelName - 模型组名
 * @param selected - 有序 fallback 目标
 * @param recurse - 是否允许目标继续自身的链
 */
export function updateModelFallbacks(
	current: unknown,
	modelName: string,
	selected: readonly string[],
	recurse = true,
): Record<string, unknown> {
	const router = { ...modelRecord(current) };
	delete router.model_group_retry_policy;
	const existing: unknown[] = Array.isArray(router.fallbacks) ? router.fallbacks : [];
	const stored = selected.length === 0 ? null : recurse ? [...selected] : { targets: [...selected], recurse: false };
	let replaced = false;
	const merged = existing
		.map((entry) => {
			const next = { ...modelRecord(entry) };
			if (Object.prototype.hasOwnProperty.call(next, modelName)) {
				replaced = true;
				if (stored === null) delete next[modelName];
				else next[modelName] = stored;
			}
			return next;
		})
		.filter((entry) => Object.keys(entry).length > 0);
	if (!replaced && stored !== null) merged.push({ [modelName]: stored });
	return { ...router, fallbacks: merged };
}
