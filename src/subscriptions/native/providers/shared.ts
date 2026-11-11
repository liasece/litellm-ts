/**
 * 订阅 Provider 适配器共用工具。
 */

import { ApiError } from "../../../core/api/ApiError";
import type { SubscriptionAccount, SubscriptionUpstreamPlan } from "../types";

/** 常见 JSON 请求头。 */
export const JSON_HEADERS: Readonly<Record<string, string>> = {
	"Content-Type": "application/json",
	Accept: "application/json",
};

/** SSE 请求头。 */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
	"Content-Type": "application/json",
	Accept: "text/event-stream",
};

/**
 * 拼接 base URL 与路径。
 * @param base - 基础地址（可带尾斜杠）
 * @param path - 以 / 开头的路径
 */
export function joinUrl(base: string, path: string): string {
	return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * 读取账号上的字符串字段。
 * @param account - 账号
 * @param keys - 候选键
 */
export function accountString(account: SubscriptionAccount, ...keys: readonly string[]): string | undefined {
	for (const key of keys) {
		const value = account.raw[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

/**
 * 读取账号上的布尔字段。
 * @param account - 账号
 * @param key - 键
 */
export function accountBoolean(account: SubscriptionAccount, key: string): boolean | undefined {
	const value = account.raw[key];
	return typeof value === "boolean" ? value : undefined;
}

/**
 * 读取嵌套对象字段。
 * @param account - 账号
 * @param key - 顶层键
 */
export function accountRecord(account: SubscriptionAccount, key: string): Record<string, unknown> | undefined {
	const value = account.raw[key];
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * 构造带 Bearer 的请求头。
 * @param credential - access token / api key
 * @param extra - 额外头
 */
export function bearerHeaders(credential: string, extra: Record<string, string> = {}): Record<string, string> {
	return { ...extra, Authorization: `Bearer ${credential}` };
}

/**
 * 构造 JSON POST 计划。
 * @param url - 上游地址
 * @param headers - 请求头
 * @param body - 请求体
 * @param model - 上游模型
 * @param stream - 是否流式
 * @param protocol - 上游协议
 */
export function jsonPlan(
	url: string,
	headers: Record<string, string>,
	body: unknown,
	model: string,
	stream: boolean,
	protocol: SubscriptionUpstreamPlan["protocol"],
): SubscriptionUpstreamPlan {
	return {
		url: url,
		method: "POST",
		headers: stream ? { ...headers, Accept: "text/event-stream" } : headers,
		body: body,
		bodyEncoding: "json",
		stream: stream,
		protocol: protocol,
		model: model,
	};
}

/**
 * 断言请求体是对象。
 * @param body - 上游请求体
 * @throws {ApiError} 请求体不是 JSON 对象时抛出
 */
export function asBodyRecord(body: unknown): Record<string, unknown> {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw ApiError.badRequest("订阅上游请求体必须是 JSON 对象");
	}
	return { ...(body as Record<string, unknown>) };
}

/**
 * 删除空值字段，避免上游因 null 报错。
 * @param body - 请求体
 * @param keys - 要检查的键
 */
export function dropNullish(body: Record<string, unknown>, keys: readonly string[]): void {
	for (const key of keys) {
		if (body[key] === undefined || body[key] === null) {
			delete body[key];
		}
	}
}

/**
 * 读取首个字符串参数。
 * @param value - 未知值
 */
export function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * 读取数值参数。
 * @param value - 未知值
 */
export function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * 拼接查询串。
 * @param base - 基础地址
 * @param query - 查询参数
 */
export function withQuery(base: string, query: Record<string, string | number | undefined>): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined && value !== "") {
			params.set(key, String(value));
		}
	}
	const suffix = params.toString();
	if (!suffix) {
		return base;
	}
	return `${base}${base.includes("?") ? "&" : "?"}${suffix}`;
}
