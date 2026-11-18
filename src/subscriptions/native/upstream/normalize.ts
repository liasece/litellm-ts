/**
 * 解析上游条目时用到的容错取值工具。
 *
 * 上游字段名与类型经常互相漂移（`max_output_tokens` / `maxOutputTokens`、
 * 数字与数字字符串、`output` 写成 `max_completion_tokens`）。这里的函数一律返回
 * `undefined` 而不是抛错：任何一家上游改字段都不应该让代理启动或请求失败。
 */

import type { UpstreamModelMetadata } from "./types";

/**
 * 普通对象判定（排除数组与 null）。
 * @param value
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * 非空字符串（去首尾空白）。
 * @param value
 */
export function asText(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 有限数字，兼容数字字符串。
 * @param value
 */
export function asNumber(value: unknown): number | undefined {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

/**
 * 布尔值，兼容 "true"/"false" 与 1/0。
 * @param value
 */
export function asBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") {
		return value;
	}
	if (value === "true" || value === 1) {
		return true;
	}
	if (value === "false" || value === 0) {
		return false;
	}
	return undefined;
}

/**
 * 字符串数组；过滤空值，空数组视为缺省。
 * @param value
 */
export function asTextArray(value: unknown): readonly string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
	return items.length > 0 ? items : undefined;
}

/**
 * 按候选键依次取第一个可用值。
 * @template T - 值类型
 * @param pickers - 候选读取函数
 */
export function firstDefined<T>(pickers: readonly (() => T | undefined)[]): T | undefined {
	for (const picker of pickers) {
		const value = picker();
		if (value !== undefined) {
			return value;
		}
	}
	return undefined;
}

/**
 * 百万 token 单价换算成 per-token。
 * @param perMillion - 上游常见的每百万 token 价格
 */
export function perMillionToPerToken(perMillion: number | undefined): number | undefined {
	return perMillion === undefined ? undefined : perMillion / 1_000_000;
}

/**
 * 去掉值为 undefined 的字段，避免把空壳写进库。
 * @param metadata - 归一化结果
 * @returns 至少有一个字段时返回新对象，全空时返回 undefined
 */
export function compactMetadata(metadata: UpstreamModelMetadata): UpstreamModelMetadata | undefined {
	const entries = Object.entries(metadata).filter(([, value]) => value !== undefined);
	return entries.length === 0 ? undefined : (Object.fromEntries(entries) as UpstreamModelMetadata);
}

/**
 * 截断过大的原始条目再入库。
 *
 * Codex 的目录条目带 `base_instructions`（数千字符的提示词）与 `model_messages`，
 * 它们对排查元信息没有价值，却会让缓存表膨胀。
 * @param entry - 上游原始条目
 * @returns 去掉大字段后的副本
 */
export function slimRawEntry(entry: unknown): unknown {
	const record = asRecord(entry);
	if (!record) {
		return entry;
	}
	const clone: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		if (key === "base_instructions" || key === "model_messages" || key === "instructions") {
			continue;
		}
		if (typeof value === "string" && value.length > 2_000) {
			clone[key] = `${value.slice(0, 2_000)}…`;
			continue;
		}
		clone[key] = value;
	}
	return clone;
}

/**
 * 从一个未知值里取出条目数组（兼容 `{data: []}` / `{models: []}` / 直接数组 / map）。
 * @param payload
 * @param keys
 */
export function extractEntries(payload: unknown, keys: readonly string[] = ["data", "models"]): readonly unknown[] {
	if (Array.isArray(payload)) {
		return payload;
	}
	const record = asRecord(payload);
	if (!record) {
		return [];
	}
	for (const key of keys) {
		const value = record[key];
		if (Array.isArray(value)) {
			return value;
		}
		// 部分上游（Cloud Code）把模型写成「ID → 条目」的 map。
		const map = asRecord(value);
		if (map) {
			return Object.entries(map).map(([id, entry]) => {
				const entryRecord = asRecord(entry);
				return entryRecord && entryRecord["id"] === undefined ? { id: id, ...entryRecord } : entry;
			});
		}
	}
	return [];
}
