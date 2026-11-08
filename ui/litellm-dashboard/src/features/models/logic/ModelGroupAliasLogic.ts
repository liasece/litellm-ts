// Mirrored from src/shared/ModelGroupAlias.ts; preserve the backend alias contract.
/** A daily interval in the alias's configured time zone. */
export interface ModelGroupAliasWindow {
	/** Inclusive local start, HH:mm. */
	start: string;
	/** Exclusive local end, HH:mm; an earlier end crosses midnight. */
	end: string;
	/** Model group or another alias used during this interval. */
	model: string;
}

/** Object form of a model group alias, preserving the legacy default target. */
export interface ModelGroupAliasConfig {
	/** Target outside the configured intervals. */
	model: string;
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

/**
 * Select one target at the supplied instant; alias traversal is handled by the caller.
 * @param value
 * @param at
 */
export function getModelGroupAliasTarget(value: ModelGroupAliasValue | undefined, at = new Date()): string | undefined {
	if (typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) {
		return value[0];
	}
	if (!value) {
		return undefined;
	}
	if (value.schedule?.length && value.timezone) {
		const parts = formatter(value.timezone).formatToParts(at);
		const hour = Number(parts.find((part) => part.type === "hour")?.value);
		const minute = hour * 60 + Number(parts.find((part) => part.type === "minute")?.value);
		const window = value.schedule.find((entry) => containsMinute(minutes(entry.start), minutes(entry.end), minute));
		if (window) {
			return window.model;
		}
	}
	return value.model;
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
		return;
	}
	if (!isRecord(value) || !isModel(value.model)) {
		throw new Error(`${label} requires a default model`);
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

function targets(value: ModelGroupAliasValue): string[] {
	if (typeof value === "string") {
		return [value];
	}
	if (Array.isArray(value)) {
		return value.slice(0, 1);
	}
	return [value.model, ...(value.schedule ?? []).map((entry) => entry.model)];
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
		for (const target of targets(aliases[name]!)) {
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
