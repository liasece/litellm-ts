/**
 * router_settings.fallbacks 的条目契约。
 *
 * 一条条目回答的是「这个模型组失败后，按什么顺序换谁」。历史上值只是目标数组，
 * 遍历时也只会走目标自己的链首，于是出现两个不可控：配置里靠后的目标永远轮不到，
 * 而目标自身的 fallback 会无条件把请求带到配置者没有预期的模型（常见是昂贵模型）。
 *
 * 现在条目可以是对象形式，为目标数组补上一个 `recurse`：
 *   - `recurse: true`（默认）—— 目标失败后允许继续走目标自己的条目，即整棵树深度优先展开；
 *   - `recurse: false` —— 目标（以及它作为别名解析到的模型组）当作叶子，
 *     不进入它的 fallback 配置，但同一条目里靠后的兄弟目标照常尝试。
 *
 * `string[]` 旧形态仍然合法，等价于 `{ targets, recurse: true }`。
 */

/** 一个模型组的 fallback 条目（对象形式）。 */
export interface FallbackTargetsConfig {
	/** 有序候选：前一项失败后尝试后一项。 */
	targets: string[];
	/** 目标失败后是否继续目标自身的 fallback 条目；默认 true。 */
	recurse?: boolean;
}

/** 条目值的两种写法：旧的目标数组或带递归开关的对象。 */
export type FallbackEntryValue = string[] | FallbackTargetsConfig;

/** 键为触发失败的模型组，值为该组的条目。 */
export type FallbackEntries = Record<string, FallbackEntryValue>;

/** PY 风格 `List[Dict]`（first-match-wins 合并）或已合并的 Record。 */
export type FallbackEntriesSource = Array<Record<string, FallbackEntryValue>> | FallbackEntries;

/** 归一化后的条目：数组形态统一成 targets + recurse。 */
export interface NormalizedFallbackEntry {
	/** 有序候选，至少一项。 */
	targets: string[];
	/** 目标失败后是否继续目标自身的 fallback 条目。 */
	recurse: boolean;
}

/** 未显式声明时的递归行为：允许向下。 */
export const DEFAULT_FALLBACK_RECURSE = true;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isModel(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/**
 * 把条目值归一化为 `{ targets, recurse }`。
 *
 * 校验与运行时分两处使用：配置解析/保存前走 {@link validateFallbackEntries} 拿到明确错误，
 * 运行期（DB 里可能残留旧值或手工写入的脏值）只跳过非法条目，不让整次路由装配失败。
 * @param value - 原始条目值
 * @returns 归一化条目；无法解释时返回空 targets
 */
export function normalizeFallbackEntry(value: unknown): NormalizedFallbackEntry {
	if (Array.isArray(value)) {
		return { targets: value.filter(isModel), recurse: DEFAULT_FALLBACK_RECURSE };
	}
	if (!isRecord(value)) {
		return { targets: [], recurse: DEFAULT_FALLBACK_RECURSE };
	}
	const targets = Array.isArray(value.targets) ? value.targets.filter(isModel) : [];
	return { targets: targets, recurse: value.recurse !== false };
}

/**
 * 校验一组 fallback 条目（数组或 Record 形态），用于配置解析与 UI 保存前的边界。
 * @param value - 待校验值
 * @throws Error 当形态、目标或递归开关不合法。
 */
export function validateFallbackEntries(value: unknown): asserts value is FallbackEntriesSource {
	const entries = Array.isArray(value) ? value : [value];
	if (!Array.isArray(value) && !isRecord(value)) {
		throw new Error("fallbacks must be an array or an object");
	}
	for (const group of entries) {
		if (!isRecord(group)) {
			throw new Error("fallbacks entries must be objects");
		}
		for (const [name, entry] of Object.entries(group)) {
			if (!name.trim()) {
				throw new Error("fallbacks model group name must not be empty");
			}
			validateValue(name, entry);
		}
	}
}

function validateValue(name: string, value: unknown): void {
	const label = `Fallback entry "${name}"`;
	if (Array.isArray(value)) {
		if (value.length === 0) {
			throw new Error(`${label} requires at least one fallback model`);
		}
		if (!value.every(isModel)) {
			throw new Error(`${label} requires non-empty model names`);
		}
		return;
	}
	if (!isRecord(value)) {
		throw new Error(`${label} must be a model list or a { targets, recurse } object`);
	}
	if (value.recurse !== undefined && typeof value.recurse !== "boolean") {
		throw new Error(`${label} recurse must be a boolean`);
	}
	if (!Array.isArray(value.targets)) {
		throw new Error(`${label} requires a targets list`);
	}
	if (value.targets.length === 0) {
		throw new Error(`${label} requires at least one fallback model`);
	}
	if (!value.targets.every(isModel)) {
		throw new Error(`${label} requires non-empty model names`);
	}
}
