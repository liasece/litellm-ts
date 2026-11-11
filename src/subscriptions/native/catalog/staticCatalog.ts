/**
 * 静态订阅模型目录。
 *
 * 数据取自 CPA 随包发布的 `subscription-models.json`（顶层键按来源/套餐分组），
 * 这里只做「顶层键 → 订阅来源」的过滤、字段映射与结果缓存，不发起任何网络请求。
 * CommandCode / OpenCode Go 的目录只存在于上游 `/models`，见 dynamicCatalog。
 *
 * 缓存按数据文件路径隔离：默认路径只读一次，测试或定制部署用 `filePath` 指向别的
 * 目录也不会污染默认路径的结果；替换文件内容后调用 {@link clearStaticCatalogCache}。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { ApiError } from "../../../core/api/ApiError";
import type { SubscriptionCatalogModel, SubscriptionSource, SubscriptionWireProtocol } from "../types";

/** 静态目录顶层键到订阅来源的映射；codex 把四个套餐键合并成一个来源。 */
export const SUBSCRIPTION_CATALOG_KEYS: Readonly<Record<SubscriptionSource, readonly string[]>> = {
	codex: ["codex-free", "codex-team", "codex-plus", "codex-pro"],
	claude: ["claude"],
	kimi: ["kimi"],
	antigravity: ["antigravity"],
	xai: ["xai"],
	commandcode: [],
	"opencode-go": [],
};

/**
 * 来源默认上游线协议。
 *
 * 目录条目本身不声明协议，这里给出各来源的上游默认值，适配器仍可按模型细化：
 * claude 只有 Messages 面；codex 的 wham 后端只有 Responses；antigravity 走 Google
 * 私有 gemini 信封；kimi / commandcode / opencode-go 按插件历史路由分别落在 chat、
 * responses、chat；xai 的 OAuth 凭据服务于 grok-shell 客户端（额度接口带
 * `x-xai-token-auth: xai-grok-cli`），默认按 Responses 计。
 */
export const SUBSCRIPTION_DEFAULT_PROTOCOL: Readonly<Record<SubscriptionSource, SubscriptionWireProtocol>> = {
	codex: "responses",
	claude: "messages",
	kimi: "chat",
	antigravity: "gemini",
	xai: "responses",
	commandcode: "responses",
	"opencode-go": "chat",
};

/** 静态目录读取选项。 */
export interface StaticCatalogOptions {
	/** 覆盖数据文件路径；默认与源码树/构建产物同布局的 `data` 目录。 */
	readonly filePath?: string;
}

/** 静态目录数据文件名。 */
const CATALOG_FILE_NAME = "subscription-models.json";

/** 顶层键 → 来源；用于给单键来源（claude/kimi/...）补默认协议。 */
const KEY_SOURCES: ReadonlyMap<string, SubscriptionSource> = new Map<string, SubscriptionSource>(
	(Object.keys(SUBSCRIPTION_CATALOG_KEYS) as SubscriptionSource[]).flatMap((source) =>
		SUBSCRIPTION_CATALOG_KEYS[source].map((key): [string, SubscriptionSource] => [key, source]),
	),
);

/** 数据文件路径 → 顶层键 → 该键下的模型。 */
const fileCache = new Map<string, Readonly<Record<string, readonly SubscriptionCatalogModel[]>>>();

/** `路径 + 来源` → 过滤合并后的模型列表。 */
const sourceCache = new Map<string, readonly SubscriptionCatalogModel[]>();

/**
 * 默认目录文件位置。
 *
 * 本模块在 `src|dist/subscriptions/native/catalog/` 下，数据文件在 `src|dist/data/`；
 * 两侧相对层级一致，`npm run build` 也会把 `src/data/*.json` 复制到 `dist/data/`。
 */
export function defaultStaticCatalogPath(): string {
	return path.join(__dirname, "..", "..", "..", "data", CATALOG_FILE_NAME);
}

/**
 * 清空静态目录缓存。
 *
 * 数据文件被替换、或测试需要重新读取同一路径时使用；下一次访问会重新解析文件。
 */
export function clearStaticCatalogCache(): void {
	fileCache.clear();
	sourceCache.clear();
}

/**
 * 读取并过滤某一订阅来源的静态模型目录。
 * @param source - 订阅来源
 * @param options - 数据文件覆盖（测试或定制部署）
 * @returns 该来源的模型列表；动态来源（commandcode/opencode-go）返回空数组
 * @throws ApiError 数据文件缺失、不是合法 JSON 或顶层不是对象时抛出
 */
export function staticCatalogForSource(
	source: SubscriptionSource,
	options: StaticCatalogOptions = {},
): readonly SubscriptionCatalogModel[] {
	const filePath = options.filePath ?? defaultStaticCatalogPath();
	const cacheKey = `${filePath}\u0000${source}`;
	const cached = sourceCache.get(cacheKey);
	if (cached) {
		return cached;
	}
	const selected = selectModels(readStaticCatalog(filePath), source);
	const frozen = Object.freeze(selected);
	sourceCache.set(cacheKey, frozen);
	return frozen;
}

/**
 * 读取并解析数据文件（带磁盘缓存）。
 * @param filePath - 数据文件路径
 * @returns 顶层键 → 该键下的模型列表
 * @throws ApiError 文件读取、JSON 解析或顶层结构校验失败时抛出
 */
function readStaticCatalog(filePath: string): Readonly<Record<string, readonly SubscriptionCatalogModel[]>> {
	const resolved = path.resolve(filePath);
	const cached = fileCache.get(resolved);
	if (cached) {
		return cached;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(resolved, "utf8")) as unknown;
	} catch (error) {
		throw ApiError.unavailable(`静态订阅模型目录读取失败: ${describeError(error)}`);
	}
	const root = recordOf(parsed);
	if (!root) {
		throw ApiError.unavailable("静态订阅模型目录格式无效");
	}
	const byKey: Record<string, readonly SubscriptionCatalogModel[]> = {};
	for (const [key, value] of Object.entries(root)) {
		byKey[key] = mapKeyEntries(key, value);
	}
	const frozen = Object.freeze(byKey);
	fileCache.set(resolved, frozen);
	return frozen;
}

/**
 * 映射一个顶层键下的条目。
 * @param key - 顶层键
 * @param value - 该键的原始值
 * @returns 可用的模型列表；非数组或条目全部无效时为空数组
 */
function mapKeyEntries(key: string, value: unknown): readonly SubscriptionCatalogModel[] {
	if (!Array.isArray(value)) {
		return Object.freeze([]);
	}
	const models: SubscriptionCatalogModel[] = [];
	for (const entry of value) {
		const model = mapStaticModel(key, entry);
		if (model) {
			models.push(model);
		}
	}
	return Object.freeze(models);
}

/**
 * 把一条目录条目映射为 {@link SubscriptionCatalogModel}。
 * @param key - 条目所在的顶层键
 * @param entry - 原始条目
 * @returns 映射结果；缺少 id 或不是对象时返回 undefined
 */
function mapStaticModel(key: string, entry: unknown): SubscriptionCatalogModel | undefined {
	const raw = recordOf(entry);
	if (!raw) {
		return undefined;
	}
	const id = textOf(raw["id"]) ?? textOf(raw["name"]);
	if (!id) {
		return undefined;
	}
	const source = KEY_SOURCES.get(key);
	const displayName = textOf(raw["display_name"]) ?? textOf(raw["name"]) ?? id;
	return {
		id: id,
		upstreamId: id,
		displayName: displayName,
		...(source ? { protocol: SUBSCRIPTION_DEFAULT_PROTOCOL[source] } : {}),
		metadata: compact({
			catalogKey: key,
			type: textOf(raw["type"]),
			object: textOf(raw["object"]),
			ownedBy: textOf(raw["owned_by"]),
			description: textOf(raw["description"]),
			version: textOf(raw["version"]),
			contextLength: numberValue(raw["context_length"]),
			maxOutputTokens: numberValue(raw["max_completion_tokens"]),
			createdAt: numberValue(raw["created"]),
			inputModalities: stringsOf(raw["supportedInputModalities"]),
			outputModalities: stringsOf(raw["supportedOutputModalities"]),
			supportedParameters: stringsOf(raw["supported_parameters"]),
			thinking: raw["thinking"],
			nativeCapabilities: raw["native_capabilities"],
			raw: raw,
		}),
	};
}

/**
 * 按来源合并若干顶层键的条目。
 *
 * codex 的四个套餐键里同一模型可能重复出现（字段相同、只有套餐资格不同），
 * 这里按 id 去重并保留首次出现的字段，同时把命中的全部键记进 `catalogKeys`。
 * @param file - 已解析的数据文件
 * @param source - 订阅来源
 * @returns 该来源的模型列表（顺序为键顺序内的首次出现顺序）
 */
function selectModels(
	file: Readonly<Record<string, readonly SubscriptionCatalogModel[]>>,
	source: SubscriptionSource,
): SubscriptionCatalogModel[] {
	const merged = new Map<string, { readonly model: SubscriptionCatalogModel; readonly keys: string[] }>();
	for (const key of SUBSCRIPTION_CATALOG_KEYS[source]) {
		for (const model of file[key] ?? []) {
			const existing = merged.get(model.id);
			if (existing) {
				if (!existing.keys.includes(key)) {
					existing.keys.push(key);
				}
				continue;
			}
			merged.set(model.id, { model: model, keys: [key] });
		}
	}
	return [...merged.values()].map((entry) => ({
		...entry.model,
		metadata: { ...(entry.model.metadata ?? {}), catalogKeys: [...entry.keys] },
	}));
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
 * 去掉值为 undefined 的字段，便于 metadata 序列化与断言。
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
 * 把未知错误转成可展示的原因，不回显文件内容。
 * @param error - 捕获到的错误
 */
function describeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message.trim().length > 0 ? error.message : error.name;
	}
	return "未知错误";
}
