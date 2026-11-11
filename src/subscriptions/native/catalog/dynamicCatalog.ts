/**
 * CommandCode / OpenCode Go 动态模型目录。
 *
 * 两家供应商的目录都来自上游 `GET {base}/models`（OpenAI 风格 `{data:[...]}` 信封），
 * 认证是 `Authorization: Bearer <API key>`。这里的职责只有三件事：按插件实现的
 * URL / 请求头拉取、把条目映射成 {@link SubscriptionCatalogModel}、给模型标上路由
 * 协议提示。刷新节奏、前缀、协议开关等策略仍由调用方决定。
 *
 * 拉取失败（无 key、网络错误、非 2xx、信封缺失）一律回退到内置列表：动态目录不可用
 * 时仍要有可展示、可路由的模型。回退返回的数组与 {@link builtinCatalogForSource}
 * 是同一个冻结数组，调用方可以用 `===` 判断本次结果是内置回退。
 */

import type { SubscriptionCatalogModel, SubscriptionWireProtocol } from "../types";

/** CommandCode 上游基址（插件 config.DefaultBaseURL）。 */
export const COMMANDCODE_API_BASE = "https://api.commandcode.ai/provider/v1";

/** OpenCode Go 上游基址（插件 config.DefaultBaseURL）。 */
export const OPENCODE_API_BASE = "https://opencode.ai/zen/go/v1";

/** 目录请求超时（毫秒）。 */
export const DYNAMIC_CATALOG_TIMEOUT_MS = 15_000;

/** 有动态目录的来源。 */
export type DynamicCatalogSource = "commandcode" | "opencode-go";

/**
 * OpenCode Go 的家族前缀 → 上游协议。
 *
 * 与插件内置兼容表一致（最长前缀优先，列表按前缀长度降序）：上游按家族分派到
 * chat-completions / messages / responses，未命中任何前缀的模型没有确定路由，
 * 因此不标协议，由适配器决定是否可服务。
 */
const OPENCODE_ROUTE_PREFIXES: ReadonlyArray<readonly [string, SubscriptionWireProtocol]> = [
	["muse-spark", "responses"],
	["deepseek", "chat"],
	["minimax", "messages"],
	["longcat", "chat"],
	["grok", "responses"],
	["gpt", "responses"],
	["kimi", "chat"],
	["qwen", "messages"],
	["glm", "chat"],
	["mimo", "chat"],
	["hy", "chat"],
];

/** CommandCode 的默认路由：只有 Claude 家族必须走 messages，其余走 responses。 */
const COMMANDCODE_CLAUDE_ROUTE: SubscriptionWireProtocol = "messages";
const COMMANDCODE_DEFAULT_ROUTE: SubscriptionWireProtocol = "responses";

/**
 * 内置回退目录。
 *
 * 两家插件都没有随包静态目录，这里只保留本仓库文档声明的公开示例模型
 * （`native/subscriptions/README.md` 的部署表），保证目录刷新失败时仍有一个可路由项。
 */
const BUILTIN_CATALOG: Readonly<Record<DynamicCatalogSource, readonly SubscriptionCatalogModel[]>> = Object.freeze({
	commandcode: Object.freeze([
		Object.freeze({
			id: "deepseek/deepseek-v4.1-flash",
			upstreamId: "deepseek/deepseek-v4.1-flash",
			displayName: "DeepSeek V4.1 Flash (CommandCode)",
			protocol: "responses",
			metadata: Object.freeze({ builtin: true }),
		}),
	]),
	"opencode-go": Object.freeze([
		Object.freeze({
			id: "deepseek-v4.1-flash",
			upstreamId: "deepseek-v4.1-flash",
			displayName: "DeepSeek V4.1 Flash (OpenCode Go)",
			protocol: "chat",
			metadata: Object.freeze({ builtin: true }),
		}),
	]),
});

/** 动态目录请求参数。 */
interface DynamicCatalogRequest {
	/** 来源。 */
	readonly source: DynamicCatalogSource;
	/** API key。 */
	readonly apiKey: string;
	/** 目录 URL。 */
	readonly url: string;
	/** fetch 实现。 */
	readonly fetchImpl: typeof fetch;
}

/** 一次目录拉取的结果；失败时 models 为 null。 */
interface DynamicCatalogFetch {
	/** 解析出的模型；失败为 null。 */
	readonly models: readonly SubscriptionCatalogModel[] | null;
	/** 失败原因（不含 key）。 */
	readonly error?: string;
}

/**
 * 内置回退目录。
 * @param source - 动态来源
 * @returns 冻结的模型列表；刷新失败时 {@link fetchCommandCodeCatalog} /
 * {@link fetchOpenCodeCatalog} 返回的就是这个数组
 */
export function builtinCatalogForSource(source: DynamicCatalogSource): readonly SubscriptionCatalogModel[] {
	return BUILTIN_CATALOG[source];
}

/**
 * 拉取 CommandCode 目录。
 * @param apiKey - CommandCode API key；空值表示没有可用凭据，直接回退内置目录
 * @param fetchImpl - 注入的 fetch；测试使用
 * @returns 上游目录；失败时回退内置目录
 */
export async function fetchCommandCodeCatalog(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<readonly SubscriptionCatalogModel[]> {
	const result = await requestCatalog({
		source: "commandcode",
		apiKey: apiKey,
		url: `${COMMANDCODE_API_BASE}/models`,
		fetchImpl: fetchImpl,
	});
	return result.models ?? builtinCatalogForSource("commandcode");
}

/**
 * 拉取 OpenCode Go 目录。
 * @param apiKey - OpenCode Go API key；空值表示没有可用凭据，直接回退内置目录
 * @param fetchImpl - 注入的 fetch；测试使用
 * @returns 上游目录；失败时回退内置目录
 */
export async function fetchOpenCodeCatalog(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<readonly SubscriptionCatalogModel[]> {
	const result = await requestCatalog({
		source: "opencode-go",
		apiKey: apiKey,
		url: `${OPENCODE_API_BASE}/models`,
		fetchImpl: fetchImpl,
	});
	return result.models ?? builtinCatalogForSource("opencode-go");
}

/**
 * 执行一次目录拉取。
 * @param request - 来源、key、URL 与 fetch
 * @returns 解析结果；任何失败都折叠为 models: null 与分类原因
 */
async function requestCatalog(request: DynamicCatalogRequest): Promise<DynamicCatalogFetch> {
	const apiKey = request.apiKey.trim();
	if (apiKey.length === 0) {
		return { models: null, error: "缺少 API key" };
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), DYNAMIC_CATALOG_TIMEOUT_MS);
	try {
		const response = await request.fetchImpl(request.url, {
			method: "GET",
			headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
			signal: controller.signal,
		});
		if (!response.ok) {
			return { models: null, error: `HTTP ${response.status}` };
		}
		const text = await response.text();
		let payload: unknown;
		try {
			payload = JSON.parse(text) as unknown;
		} catch {
			return { models: null, error: "响应不是合法 JSON" };
		}
		const entries = catalogEntries(payload);
		if (!entries) {
			return { models: null, error: "响应缺少模型列表" };
		}
		return { models: mapDynamicModels(request.source, entries) };
	} catch (error) {
		return { models: null, error: describeError(error) };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * 从响应体里取出条目数组。
 *
 * 兼容裸数组、`{data:[...]}`（两家上游的 OpenAI 风格信封）与 `{models:[...]}`。
 * `data` 存在但是空数组是上游的「当前没有模型」，按空目录返回；字段缺失才算信封漂移。
 * @param payload - 已解析的响应体
 * @returns 条目数组；无法识别时为 undefined
 */
function catalogEntries(payload: unknown): unknown[] | undefined {
	if (Array.isArray(payload)) {
		return payload;
	}
	const record = recordOf(payload);
	if (!record) {
		return undefined;
	}
	for (const key of ["data", "models"]) {
		const value = record[key];
		if (Array.isArray(value)) {
			return value;
		}
	}
	return undefined;
}

/**
 * 把上游条目映射成模型列表（按 id 去重，保留首次出现）。
 * @param source - 来源
 * @param entries - 上游条目
 * @returns 冻结的模型列表
 */
function mapDynamicModels(source: DynamicCatalogSource, entries: readonly unknown[]): readonly SubscriptionCatalogModel[] {
	const models: SubscriptionCatalogModel[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		const raw = recordOf(entry);
		if (!raw) {
			continue;
		}
		const id = textOf(raw["id"]) ?? textOf(raw["name"]);
		if (!id || seen.has(id)) {
			continue;
		}
		seen.add(id);
		const protocol = dynamicProtocol(source, id);
		models.push({
			id: id,
			upstreamId: id,
			displayName: textOf(raw["display_name"]) ?? textOf(raw["displayName"]) ?? id,
			...(protocol ? { protocol: protocol } : {}),
			metadata: compact({
				description: textOf(raw["description"]),
				contextLength: numberValue(raw["context_length"]) ?? numberValue(raw["contextLength"]),
				maxOutputTokens: numberValue(raw["max_output_tokens"]) ?? numberValue(raw["maxOutputTokens"]),
				inputModalities: stringsOf(raw["input_modalities"] ?? raw["inputModes"] ?? raw["supportedInputModalities"]),
				outputModalities: stringsOf(raw["output_modalities"] ?? raw["outputModes"] ?? raw["supportedOutputModalities"]),
				thinking: raw["thinking"],
				raw: raw,
			}),
		});
	}
	return Object.freeze(models);
}

/**
 * 解析一个上游模型 ID 的路由协议。
 * @param source - 来源
 * @param id - 上游模型 ID
 * @returns 协议提示；OpenCode Go 未命中家族前缀时为 undefined
 */
function dynamicProtocol(source: DynamicCatalogSource, id: string): SubscriptionWireProtocol | undefined {
	const name = id.trim().toLowerCase();
	if (source === "commandcode") {
		const lastSegment = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
		return lastSegment.startsWith("claude") ? COMMANDCODE_CLAUDE_ROUTE : COMMANDCODE_DEFAULT_ROUTE;
	}
	for (const [prefix, protocol] of OPENCODE_ROUTE_PREFIXES) {
		if (name.startsWith(prefix)) {
			return protocol;
		}
	}
	return undefined;
}

/**
 * 是否为普通对象。
 * @param value - 待判定值
 */
function recordOf(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * 非空字符串。
 * @param value - 待判定值
 */
function textOf(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 有限数字（兼容数字字符串）。
 * @param value - 待判定值
 */
function numberValue(value: unknown): number | undefined {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (typeof value !== "string" || value.trim() === "") {
		return undefined;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 字符串数组。
 * @param value - 待判定值
 */
function stringsOf(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const values = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
	return values.length > 0 ? values : undefined;
}

/**
 * 去掉值为 undefined 的字段。
 * @param values - 原始键值
 */
function compact(values: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(values)) {
		if (value !== undefined) {
			result[key] = value;
		}
	}
	return result;
}

/**
 * 把未知错误转成可展示的原因，不包含请求头或 key。
 * @param error - 捕获到的错误
 */
function describeError(error: unknown): string {
	if (error instanceof Error) {
		if (error.name === "AbortError") {
			return "请求超时";
		}
		return error.message.trim().length > 0 ? error.message : error.name;
	}
	return "网络请求失败";
}
