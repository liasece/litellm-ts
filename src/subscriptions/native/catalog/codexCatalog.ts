/**
 * Codex 上游模型目录。
 *
 * Codex 订阅能用哪些模型由 ChatGPT 后端下发：`GET {base}/models?client_version=…`
 * 按客户端 semver 过滤，每条带 `minimal_client_version`、`visibility` 与推理档位。
 * 随包的静态目录（`subscription-models.json`）只是某一时刻的快照，新模型在静态文件
 * 更新前不会出现，所以运行时向上游要列表。
 *
 * 发现用的 `client_version` 故意取高于任何模型下限的值：它只影响服务端过滤，不改变
 * 代理实现的线协议——真实请求仍原样透传模型 slug，responses-lite 等能力由适配器按
 * 请求头决定。拉取失败（无可用账号、网络错误、非 2xx、信封不符）一律抛错，由调用方
 * 回退静态目录，目录不可用不能变成「没有模型」。
 */

import { ApiError } from "../../../core/api/ApiError";
import type { SubscriptionCatalogModel } from "../types";

/** Codex 默认上游根地址；账号 `base_url` 覆盖时以账号为准。 */
const CODEX_DEFAULT_BASE_URL = "https://chatgpt.com/backend-api/codex";

/**
 * 目录发现用的客户端版本。
 *
 * 上游对每条模型给出 `minimal_client_version`，低于它就不下发；这里不模拟某个具体
 * 客户端，只取一个足够新的版本，让目录始终反映上游当前在售模型。若上游开始按上限
 * 约束版本，这里需要跟随调整。
 */
export const CODEX_CATALOG_CLIENT_VERSION = "99.0.0";

/** 目录请求超时（毫秒）；超时即回退静态目录。 */
export const CODEX_CATALOG_TIMEOUT_MS = 8_000;

/** 目录请求参数。 */
export interface CodexCatalogRequest {
	/** 账号 access token。 */
	readonly accessToken: string;
	/** ChatGPT 账号 ID，用于 `Chatgpt-Account-Id`。 */
	readonly accountId: string;
	/** 上游根地址；默认 {@link CODEX_DEFAULT_BASE_URL}。 */
	readonly baseUrl?: string;
	/** 覆盖客户端版本；测试或定制部署使用。 */
	readonly clientVersion?: string;
	/** 注入的 fetch；测试使用。 */
	readonly fetchImpl?: typeof fetch;
	/** 覆盖超时；测试使用。 */
	readonly timeoutMs?: number;
}

/**
 * 拉取 Codex 上游模型目录。
 * @param request - 请求参数
 * @returns 上游下发的公开模型
 * @throws {ApiError} 请求失败、状态非 2xx 或响应不是预期信封时抛出
 */
export async function fetchCodexCatalog(request: CodexCatalogRequest): Promise<readonly SubscriptionCatalogModel[]> {
	const base = (request.baseUrl ?? CODEX_DEFAULT_BASE_URL).replace(/\/+$/, "");
	const url = new URL(base + "/models");
	url.searchParams.set("client_version", request.clientVersion ?? CODEX_CATALOG_CLIENT_VERSION);
	const fetchImpl = request.fetchImpl ?? fetch;
	let response: Response;
	try {
		response = await fetchImpl(url.href, {
			headers: {
				Authorization: `Bearer ${request.accessToken}`,
				"Chatgpt-Account-Id": request.accountId,
				Originator: "codex-tui",
				"User-Agent": "codex-tui",
				Accept: "application/json",
			},
			signal: AbortSignal.timeout(request.timeoutMs ?? CODEX_CATALOG_TIMEOUT_MS),
		});
	} catch (error) {
		throw ApiError.unavailable(`Codex 模型目录请求失败：${error instanceof Error ? error.message : String(error)}`);
	}
	if (!response.ok) {
		throw ApiError.unavailable(`Codex 模型目录请求失败：HTTP ${response.status}`);
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw ApiError.unavailable("Codex 模型目录响应不是合法 JSON");
	}
	return mapCodexCatalog(payload);
}

/**
 * 把上游目录信封映射成订阅模型。
 *
 * 只保留可对外服务的条目：`supported_in_api` 为 false 的是内部模型，
 * `visibility` 为 `hide` 的是上游隐藏项（如 `gpt-reserve`），它们不该出现在
 * 选择列表里。
 * @param payload - 上游响应体
 * @returns 映射后的模型列表
 * @throws {ApiError} 响应缺少 `models` 数组时抛出
 */
export function mapCodexCatalog(payload: unknown): readonly SubscriptionCatalogModel[] {
	const models = asRecord(payload)?.["models"];
	if (!Array.isArray(models)) {
		throw ApiError.unavailable("Codex 模型目录响应缺少 models 数组");
	}
	const result: SubscriptionCatalogModel[] = [];
	for (const entry of models) {
		const model = asRecord(entry);
		if (!model) {
			continue;
		}
		const slug = typeof model["slug"] === "string" ? model["slug"].trim() : "";
		if (!slug || model["supported_in_api"] === false || model["visibility"] === "hide") {
			continue;
		}
		const displayName = typeof model["display_name"] === "string" ? model["display_name"] : slug;
		result.push({
			id: slug,
			upstreamId: slug,
			displayName: displayName,
			protocol: "responses",
			metadata: {
				catalogKey: "codex-upstream",
				description: typeof model["description"] === "string" ? model["description"] : undefined,
				contextWindow: numberOrUndefined(model["context_window"]),
				maxContextWindow: numberOrUndefined(model["max_context_window"]),
				reasoningLevels: reasoningLevels(model["supported_reasoning_levels"]),
				defaultReasoningLevel: typeof model["default_reasoning_level"] === "string" ? model["default_reasoning_level"] : undefined,
				minimalClientVersion: typeof model["minimal_client_version"] === "string" ? model["minimal_client_version"] : undefined,
				useResponsesLite: model["use_responses_lite"] === true,
			},
		});
	}
	return result;
}

/**
 * 读取对象形态的 JSON 值。
 * @param value - 任意 JSON 值
 * @returns 对象本体；数组、null 与其他标量返回 undefined
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * 读取有限数值。
 * @param value - 任意 JSON 值
 * @returns 有限数；缺失或非法值返回 undefined
 */
function numberOrUndefined(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * 提取推理档位名称。
 * @param value - 上游 `supported_reasoning_levels`
 * @returns 档位名称；空列表或形状不符时返回 undefined
 */
function reasoningLevels(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const levels = value
		.map((entry) => asRecord(entry)?.["effort"])
		.filter((effort): effort is string => typeof effort === "string" && effort.length > 0);
	return levels.length ? levels : undefined;
}
