/**
 * model_group_alias 的共享契约（后端与 Dashboard 各一份实现，语义必须一致）。
 *
 * alias 值有三种写法：
 *   - `string`    —— 单一目标；
 *   - `string[]`  —— 有序目标：首项是主目标，其余是失败后按顺序尝试的同级候选；
 *   - 对象        —— `targets`（同上）、`recurse`（目标失败后是否继续目标自身的 fallback），
 *                    以及 `hidden` / `timezone` / `schedule`（按每日时段切换主目标）。
 *
 * `model` 是对象形态的历史字段，等价于只有一项的 `targets`；新写入统一用 `targets`，
 * 两者互斥，避免同一个目标既写在 `model` 又写在 `targets` 里产生歧义。
 */

/** A daily interval in the alias's configured time zone. */
export interface ModelGroupAliasWindow {
	/** Inclusive local start, HH:mm. */
	start: string;
	/** Exclusive local end, HH:mm; an earlier end crosses midnight. */
	end: string;
	/** Model group or another alias used during this interval. */
	model: string;
}

/** Object form of a model group alias. */
export interface ModelGroupAliasConfig {
	/** Legacy single default target; mutually exclusive with `targets`. */
	model?: string;
	/** Ordered targets: the first is the primary target, the rest are same-level candidates. */
	targets?: string[];
	/** Whether a failed target may continue along its own fallback entry; defaults to true. */
	recurse?: boolean;
	/** Whether the alias should be hidden from model listings. */
	hidden?: boolean;
	/** IANA time zone; required for a nonempty schedule. */
	timezone?: string;
	/** Non-overlapping intervals repeated every day. */
	schedule?: ModelGroupAliasWindow[];
}

/** Legacy aliases and aliases with daily schedules. */
export type ModelGroupAliasValue = string | string[] | ModelGroupAliasConfig;
/** Complete alias map, replaced as one configuration value. */
export type ModelGroupAliases = Record<string, ModelGroupAliasValue>;

const formatters = new Map<string, Intl.DateTimeFormat>();
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function formatter(timezone: string): Intl.DateTimeFormat {
	let result = formatters.get(timezone);
	if (!result) {
		result = new Intl.DateTimeFormat("en-GB", {
			timeZone: timezone,
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		});
		formatters.set(timezone, result);
	}
	return result;
}

function minutes(time: string): number {
	return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function containsMinute(start: number, end: number, minute: number): boolean {
	return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** One alias evaluation: ordered targets and whether a daily window chose the primary. */
export interface ModelGroupAliasSelection {
	/** Primary target for this evaluation; the first element of `targets`. */
	target: string;
	/** True when a schedule window (not the default target) produced the primary target. */
	scheduled: boolean;
	/** Primary first, then the same-level candidates declared by the alias. */
	targets: string[];
}

function orderedTargets(value: ModelGroupAliasConfig): string[] {
	if (value.targets !== undefined) {
		return [...value.targets];
	}
	return value.model === undefined ? [] : [value.model];
}

function activeWindow(value: ModelGroupAliasConfig, at: Date): ModelGroupAliasWindow | undefined {
	if (!value.schedule?.length || !value.timezone) {
		return undefined;
	}
	const parts = formatter(value.timezone).formatToParts(at);
	const hour = Number(parts.find((part) => part.type === "hour")?.value);
	const minute = hour * 60 + Number(parts.find((part) => part.type === "minute")?.value);
	return value.schedule.find((entry) => containsMinute(minutes(entry.start), minutes(entry.end), minute));
}

/**
 * Select the ordered targets at the supplied instant.
 *
 * The distinction `scheduled` is only used for observability: an alias that silently switches
 * models by time of day is a different routing capability from a static rename.
 * @param value
 * @param at
 */
export function selectModelGroupAliasTargets(
	value: ModelGroupAliasValue | undefined,
	at = new Date(),
): ModelGroupAliasSelection | undefined {
	if (typeof value === "string") {
		return value.trim() ? { target: value, scheduled: false, targets: [value] } : undefined;
	}
	if (Array.isArray(value)) {
		const [primary] = value;
		return primary === undefined ? undefined : { target: primary, scheduled: false, targets: [...value] };
	}
	if (!value) {
		return undefined;
	}
	const ordered = orderedTargets(value);
	const window = activeWindow(value, at);
	const primary = window?.model ?? ordered[0];
	if (primary === undefined) {
		return undefined;
	}
	// 时段 alias 的另一侧目标是「另一个时段的默认目标」，不是失败后的备选；
	// 只有显式声明 targets 的别名才有同级候选。
	const targets =
		value.targets === undefined ? [primary] : [primary, ...ordered.filter((target) => target !== primary)];
	return { target: primary, scheduled: window !== undefined, targets: targets };
}

/**
 * Select one target at the supplied instant, reporting whether a schedule window decided it.
 * @param value
 * @param at
 */
export function selectModelGroupAliasTarget(
	value: ModelGroupAliasValue | undefined,
	at = new Date(),
): ModelGroupAliasSelection | undefined {
	return selectModelGroupAliasTargets(value, at);
}

/**
 * Select the primary target at the supplied instant; alias traversal is handled by the caller.
 * @param value
 * @param at
 */
export function getModelGroupAliasTarget(value: ModelGroupAliasValue | undefined, at = new Date()): string | undefined {
	return selectModelGroupAliasTargets(value, at)?.target;
}

/**
 * 该 alias 命中失败后能否继续目标自身的 fallback 条目。
 * 只有对象形态可以声明；旧写法保持历史行为（允许向下）。
 * @param value
 */
export function getModelGroupAliasRecurse(value: ModelGroupAliasValue | undefined): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return true;
	}
	return value.recurse !== false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isModel(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function validateValue(name: string, value: unknown): void {
	const label = `Model group alias "${name}"`;
	if (typeof value === "string" || Array.isArray(value)) {
		if (typeof value === "string" ? !isModel(value) : !value.every(isModel)) {
			throw new Error(`${label} requires non-empty model names`);
		}
		// 空数组是历史遗留的退化解（等价于没有目标），保持可读入以免旧配置无法加载。
		return;
	}
	if (!isRecord(value)) {
		throw new Error(`${label} requires a target model`);
	}
	if (value.model !== undefined && value.targets !== undefined) {
		throw new Error(`${label} must use either model or targets, not both`);
	}
	if (value.targets !== undefined) {
		if (!Array.isArray(value.targets) || value.targets.length === 0) {
			throw new Error(`${label} requires a non-empty targets list`);
		}
		if (!value.targets.every(isModel)) {
			throw new Error(`${label} requires non-empty model names`);
		}
	} else if (!isModel(value.model)) {
		throw new Error(`${label} requires a default model`);
	}
	if (value.recurse !== undefined && typeof value.recurse !== "boolean") {
		throw new Error(`${label} recurse must be a boolean`);
	}
	if (value.hidden !== undefined && typeof value.hidden !== "boolean") {
		throw new Error(`${label} hidden must be a boolean`);
	}
	if (value.schedule !== undefined && !Array.isArray(value.schedule)) {
		throw new Error(`${label} schedule must be an array`);
	}
	const schedule = (value.schedule ?? []) as unknown[];
	if (value.timezone !== undefined || schedule.length > 0) {
		if (typeof value.timezone !== "string" || !value.timezone.trim()) {
			throw new Error(`${label} requires an IANA timezone for its schedule`);
		}
		try {
			formatter(value.timezone);
		} catch {
			throw new Error(`${label} has an invalid timezone`);
		}
	}
	const intervals: Array<[number, number]> = [];
	for (const entry of schedule) {
		if (!isRecord(entry) || !isModel(entry.model)) {
			throw new Error(`${label} schedule entries require a target model`);
		}
		if (
			typeof entry.start !== "string" ||
			typeof entry.end !== "string" ||
			!timePattern.test(entry.start) ||
			!timePattern.test(entry.end)
		) {
			throw new Error(`${label} schedule times must use HH:mm (00:00–23:59)`);
		}
		const start = minutes(entry.start);
		const end = minutes(entry.end);
		if (start === end) {
			throw new Error(`${label} schedule start and end must differ`);
		}
		if (start < end) {
			intervals.push([start, end]);
		} else {
			intervals.push([start, 1440]);
			if (end > 0) {
				intervals.push([0, end]);
			}
		}
	}
	intervals.sort((a, b) => a[0] - b[0]);
	for (let index = 1; index < intervals.length; index++) {
		if (intervals[index]![0] < intervals[index - 1]![1]) {
			throw new Error(`${label} schedule intervals must not overlap`);
		}
	}
}

/**
 * 所有可能出现的跳转目标，用于在任何时段配置下都做一次环检测。
 * @param value - 别名配置
 */
function allTargets(value: ModelGroupAliasValue): string[] {
	if (typeof value === "string") {
		return [value];
	}
	if (Array.isArray(value)) {
		return [...value];
	}
	return [...orderedTargets(value), ...(value.schedule ?? []).map((entry) => entry.model)];
}

/**
 * Validate all branches before saving, including cycles in currently inactive intervals.
 * @param value
 * @throws Error when a value, schedule or potential alias path is invalid.
 */
export function validateModelGroupAliases(value: unknown): asserts value is ModelGroupAliases {
	if (!isRecord(value)) {
		throw new Error("model_group_alias must be an object");
	}
	for (const [name, entry] of Object.entries(value)) {
		if (!name.trim()) {
			throw new Error("Model group alias name must not be empty");
		}
		validateValue(name, entry);
	}
	const aliases = value as ModelGroupAliases;
	const complete = new Set<string>();
	const active = new Set<string>();
	const path: string[] = [];
	const visit = (name: string): void => {
		if (active.has(name)) {
			throw new Error(`Model group alias cycle detected: ${[...path, name].join(" -> ")}`);
		}
		if (complete.has(name) || !Object.prototype.hasOwnProperty.call(aliases, name)) {
			return;
		}
		active.add(name);
		path.push(name);
		for (const target of allTargets(aliases[name]!)) {
			visit(target);
		}
		path.pop();
		active.delete(name);
		complete.add(name);
	};
	for (const name of Object.keys(aliases)) {
		visit(name);
	}
}
