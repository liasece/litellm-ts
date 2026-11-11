/**
 * xAI 订阅 Provider 适配器。
 *
 * xAI 上游只有一套 Responses 语义：`chat` / `messages` / `responses` 入口统一转发到
 * `<base>/responses`；媒体操作分别走 `/images/*`、`/videos/*` 与 `/tts`。这里的 URL、
 * 请求头与请求体特化对齐 Go 实现 `internal/runtime/executor/xai_executor*.go`
 * （CLIProxyAPI v8.0.57），保证同一份账号与同一批客户端行为一致。
 *
 * OAuth 账号默认走 Grok Build 的 CLI chat-proxy（`cli-chat-proxy.grok.com`）：chat 与
 * 媒体请求带 CLI 身份头。`/responses/compact` 与 `/tts` 必须留在官方 API，
 * cli-chat-proxy 分别返回 404 与 405。账号上显式配置的非默认 `base_url` 始终优先。
 */

import { ApiError } from "../../../core/api/ApiError";
import type { CliProxyAccountQuota } from "../../../cliproxy/CliProxyTypes";
import { createXaiAuth } from "../auth/xai";
import type { XaiAuthHandler } from "../auth/xai";
import { catalogForSource } from "../catalog/catalog";
import { quotaForAccount } from "../quota/quota";
import { sanitizeXaiResponsesInput } from "../protocol/signatureTargets";
import { sessionKeyValue } from "../session";
import { normalizeToolNames } from "../toolNames";
import type {
	SubscriptionAccount,
	SubscriptionCatalogModel,
	SubscriptionOperation,
	SubscriptionProviderAdapter,
	SubscriptionQuotaSnapshot,
	SubscriptionQuotaWindow,
	SubscriptionRequestContext,
	SubscriptionUpstreamContext,
	SubscriptionUpstreamPlan,
	SubscriptionWireProtocol,
} from "../types";
import { asBodyRecord, asNumber, asString, joinUrl } from "./shared";
import type { SubscriptionProviderDependencies } from "./types";

/** 官方 xAI API 基础地址。 */
const DEFAULT_API_BASE_URL = "https://api.x.ai/v1";

/** Grok Build 的 CLI chat-proxy 基础地址。 */
const CLI_CHAT_PROXY_BASE_URL = "https://cli-chat-proxy.grok.com/v1";

/** 取不到 hub 版本时上报的 Grok CLI 版本（对齐 Go 回退值）。 */
const FALLBACK_CLIENT_VERSION = "1.0.46";

/** 服务端要求的最低 Grok CLI 版本；低于此值会被 426 拒绝。 */
const SERVER_FLOOR_CLIENT_VERSION = "1.0.13";

/** CLI 身份头。 */
const TOKEN_AUTH_HEADER = "X-XAI-Token-Auth";

/** CLI 身份头的固定值。 */
const TOKEN_AUTH_VALUE = "xai-grok-cli";

/** Grok CLI 版本头。 */
const CLIENT_VERSION_HEADER = "x-grok-client-version";

/** CLI 客户端标识头。 */
const CLIENT_IDENTIFIER_HEADER = "x-grok-client-identifier";

/** CLI 客户端标识固定值。 */
const CLIENT_IDENTIFIER_VALUE = "grok-shell";

/** CLI 响应认证头。 */
const AUTHENTICATE_RESPONSE_HEADER = "x-authenticateresponse";

/** CLI 响应认证固定值。 */
const AUTHENTICATE_RESPONSE_VALUE = "authenticate-response";

/** 单次请求允许的 tools 数量上限。 */
const MAX_TOOLS = 200;

/** 原生 image_generation 工具最低 Grok 主版本。 */
const IMAGE_GENERATION_MIN_MAJOR = 4;

/** 原生 image_generation 工具最低 Grok 次版本。 */
const IMAGE_GENERATION_MIN_MINOR = 6;

/** 语音合成默认模型。 */
const SPEECH_DEFAULT_MODEL = "grok-tts";

/** 语音合成音色模型。 */
const SPEECH_VOICE_MODEL = "grok-voice-tts-1.0";

/** 默认音色。 */
const SPEECH_DEFAULT_VOICE = "eve";

/** 单次语音合成的字符上限。 */
const SPEECH_MAX_RUNES = 60_000;

/** 默认采样率（Hz）。 */
const SPEECH_SAMPLE_RATE = 24_000;

/** OpenAI 音色名到 Grok 音色 ID 的映射。 */
const OPENAI_SPEECH_VOICES: Readonly<Record<string, string>> = {
	alloy: "ara",
	ash: "orion",
	ballad: "luna",
	coral: "celeste",
	echo: "rex",
	fable: "sal",
	onyx: "leo",
	nova: "eve",
	sage: "iris",
	shimmer: "aurora",
	verse: "lumen",
};

/** 图片生成默认模型（公开别名）。 */
const IMAGE_DEFAULT_MODEL = "grok-imagine-image";

/** 图片尺寸缺省纵横比。 */
const IMAGE_DEFAULT_ASPECT_RATIO = "1:1";

/** 图片尺寸缺省分辨率。 */
const IMAGE_DEFAULT_RESOLUTION = "1k";

/** 视频生成默认模型。 */
const VIDEO_DEFAULT_MODEL = "grok-imagine-video";

/** 视频默认时长（秒）。 */
const VIDEO_DEFAULT_SECONDS = "4";

/** 视频默认尺寸。 */
const VIDEO_DEFAULT_SIZE = "720x1280";

/** 视频默认分辨率。 */
const VIDEO_DEFAULT_RESOLUTION = "720p";

/** 参考图上限。 */
const VIDEO_MAX_REFERENCES = 7;

/** web_search 工具中 xAI 不接受、必须剔除的字段。 */
const UNSUPPORTED_WEB_SEARCH_FIELDS: readonly string[] = ["external_web_access", "search_context_size"];

/** 本适配器承接的操作。 */
const SUPPORTED_OPERATIONS: ReadonlySet<SubscriptionOperation> = new Set<SubscriptionOperation>([
	"chat",
	"messages",
	"responses",
	"completions",
	"compact",
	"images.generations",
	"images.edits",
	"videos",
	"speech",
]);

/** 一个 Grok 版本号。 */
interface GrokVersion {
	/** 主版本。 */
	readonly major: number;
	/** 次版本；缺失时为 -1。 */
	readonly minor: number;
}

/**
 * 去掉思考后缀，得到上游模型名。
 * @param model - 公开模型 ID
 * @returns 上游模型名
 * @throws {ApiError} 模型 ID 为空时抛出
 */
function baseModel(model: string): string {
	const trimmed = model.trim();
	if (!trimmed) {
		throw ApiError.badRequest("xAI 请求缺少模型 ID");
	}
	const suffix = trimmed.lastIndexOf("(");
	if (suffix > 0 && trimmed.endsWith(")")) {
		return trimmed.slice(0, suffix).trim();
	}
	return trimmed;
}

/**
 * 去掉 `provider/` 前缀。
 * @param model - 模型 ID
 * @returns 末段模型名
 */
function modelLeaf(model: string): string {
	const trimmed = model.trim();
	const slash = trimmed.lastIndexOf("/");
	return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/**
 * 解析 `grok-` 之后的版本前缀。
 * @param rest - 去掉 `grok-` 的模型名
 * @returns 版本号；无法解析时缺省
 */
function parseGrokVersion(rest: string): GrokVersion | undefined {
	let index = 0;
	while (index < rest.length && rest.charCodeAt(index) >= 48 && rest.charCodeAt(index) <= 57) {
		index += 1;
	}
	if (index === 0) {
		return undefined;
	}
	const major = Number.parseInt(rest.slice(0, index), 10);
	if (!Number.isFinite(major)) {
		return undefined;
	}
	if (index === rest.length || rest[index] !== ".") {
		return { major: major, minor: -1 };
	}
	let digits = index + 1;
	while (digits < rest.length && rest.charCodeAt(digits) >= 48 && rest.charCodeAt(digits) <= 57) {
		digits += 1;
	}
	if (digits === index + 1) {
		return { major: major, minor: -1 };
	}
	const minor = Number.parseInt(rest.slice(index + 1, digits), 10);
	if (!Number.isFinite(minor)) {
		return undefined;
	}
	return { major: major, minor: minor };
}

/**
 * 判断模型是否支持原生 image_generation 工具。
 *
 * Go 规则：模型必须以 `grok-` 开头、版本不低于 4.6，且 `4.20*` 系列一律不支持。
 * @param model - 上游模型名
 * @returns 是否保留 image_generation 工具
 */
function supportsNativeImageGeneration(model: string): boolean {
	const name = modelLeaf(baseModel(model)).toLowerCase();
	if (!name.startsWith("grok-")) {
		return false;
	}
	const rest = name.slice("grok-".length);
	if (rest === "4.20" || rest.startsWith("4.20-")) {
		return false;
	}
	const version = parseGrokVersion(rest);
	if (!version) {
		return false;
	}
	if (version.major !== IMAGE_GENERATION_MIN_MAJOR) {
		return version.major > IMAGE_GENERATION_MIN_MAJOR;
	}
	return (version.minor < 0 ? 0 : version.minor) >= IMAGE_GENERATION_MIN_MINOR;
}

/**
 * 归一化 base URL。
 * @param baseUrl - 原始地址
 * @returns 去掉尾斜杠的地址
 */
function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/, "");
}

/**
 * 读取账号上显式配置的 base URL。
 * @param account - 账号
 * @returns base URL；未配置时缺省
 */
function configuredBaseUrl(account: SubscriptionAccount): string | undefined {
	const value = account.raw["base_url"];
	return typeof value === "string" && value.trim() ? normalizeBaseUrl(value) : undefined;
}

/**
 * 判断账号是否使用官方 API 语义（`using_api`）。
 *
 * 读取顺序对齐 Go：`using_api` 覆盖 > `auth_kind` 是否为 oauth。
 * @param account - 账号
 * @returns 是否走官方 API
 */
function usesOfficialApi(account: SubscriptionAccount): boolean {
	const override = account.raw["using_api"];
	if (typeof override === "boolean") {
		return override;
	}
	if (typeof override === "string" && override.trim()) {
		const normalized = override.trim().toLowerCase();
		if (normalized === "true" || normalized === "1") {
			return true;
		}
		if (normalized === "false" || normalized === "0") {
			return false;
		}
	}
	const kind = account.raw["auth_kind"];
	return !(typeof kind === "string" && kind.trim().toLowerCase() === "oauth");
}

/**
 * 计算 chat 与媒体请求使用的基础地址。
 *
 * OAuth 账号在未显式配置非默认 base URL 时改写为 CLI chat-proxy。
 * @param account - 账号
 * @returns 基础地址
 */
function chatBaseUrl(account: SubscriptionAccount): string {
	const configured = configuredBaseUrl(account);
	if (usesOfficialApi(account)) {
		return configured ?? DEFAULT_API_BASE_URL;
	}
	if (configured !== undefined && configured !== normalizeBaseUrl(DEFAULT_API_BASE_URL)) {
		return configured;
	}
	return CLI_CHAT_PROXY_BASE_URL;
}

/**
 * 计算 compact 与 speech 使用的基础地址；CLI chat-proxy 不实现这两个路径。
 * @param account - 账号
 * @returns 基础地址
 */
function officialBaseUrl(account: SubscriptionAccount): string {
	const configured = configuredBaseUrl(account);
	if (configured === undefined || configured === normalizeBaseUrl(CLI_CHAT_PROXY_BASE_URL)) {
		return DEFAULT_API_BASE_URL;
	}
	return configured;
}

/**
 * 读取上报的 Grok CLI 版本。
 * @param account - 账号
 * @returns 版本字符串
 */
function clientVersion(account: SubscriptionAccount): string {
	const configured = account.raw["client_version"];
	if (typeof configured === "string" && configured.trim()) {
		const trimmed = configured.trim();
		if (trimmed >= SERVER_FLOOR_CLIENT_VERSION) {
			return trimmed;
		}
	}
	return FALLBACK_CLIENT_VERSION;
}

/**
 * 是否附加 CLI chat-proxy 身份头。
 * @param account - 账号
 * @returns 是否附加
 */
function usesCliIdentity(account: SubscriptionAccount): boolean {
	if (usesOfficialApi(account)) {
		return false;
	}
	return normalizeBaseUrl(chatBaseUrl(account)) === normalizeBaseUrl(CLI_CHAT_PROXY_BASE_URL);
}

/**
 * 读取账号上配置的自定义请求头。
 * @param account - 账号
 * @returns 头记录
 */
function configuredHeaders(account: SubscriptionAccount): Record<string, string> {
	const raw = account.raw["headers"];
	const result: Record<string, string> = {};
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return result;
	}
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value === "string" && value.trim()) {
			result[key] = value;
		}
	}
	return result;
}

/**
 * 构造 chat 与媒体类请求头。
 * @param account - 账号
 * @param credential - access token / api key
 * @param stream - 是否流式
 * @param sessionKey - 会话键；用于 `x-grok-conv-id`
 * @param clientUserAgent - 下游 User-Agent
 * @returns 请求头
 */
function xaiHeaders(
	account: SubscriptionAccount,
	credential: string,
	stream: boolean,
	sessionKey: string,
	clientUserAgent: string | undefined,
): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Authorization: `Bearer ${credential}`,
		Accept: stream ? "text/event-stream" : "application/json",
		Connection: "Keep-Alive",
	};
	if (sessionKey) {
		headers["x-grok-conv-id"] = sessionKey;
	}
	if (usesCliIdentity(account)) {
		const version = clientVersion(account);
		headers[TOKEN_AUTH_HEADER] = TOKEN_AUTH_VALUE;
		headers[CLIENT_VERSION_HEADER] = version;
		headers["User-Agent"] = `xai-grok-workspace/${version}`;
		headers[CLIENT_IDENTIFIER_HEADER] = CLIENT_IDENTIFIER_VALUE;
		headers[AUTHENTICATE_RESPONSE_HEADER] = AUTHENTICATE_RESPONSE_VALUE;
	} else {
		headers["User-Agent"] = clientUserAgent ?? `xai-grok-workspace/${clientVersion(account)}`;
	}
	// 账号自定义头最后合并，允许覆盖默认身份头（对齐 Go 的 ApplyCustomHeadersFromAttrs）。
	return { ...headers, ...configuredHeaders(account) };
}

/**
 * 读取对象值。
 * @param value - 待判定值
 * @returns 对象记录；非对象时缺省
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * 归一化单个 tool 声明。
 * @param tool - 原始 tool
 * @param keepImageGeneration - 是否保留原生 image_generation 工具
 * @returns 归一化后的 tool；被过滤时缺省
 */
function normalizeTool(tool: Record<string, unknown>, keepImageGeneration: boolean): Record<string, unknown> | undefined {
	const type = asString(tool["type"]);
	if (type === "tool_search") {
		return undefined;
	}
	if (type === "image_generation" && !keepImageGeneration) {
		return undefined;
	}
	const result: Record<string, unknown> = { ...tool };
	if (type === "custom") {
		result["type"] = "function";
	}
	if (result["type"] === "function" && asRecord(result["parameters"]) === undefined) {
		result["parameters"] = { type: "object", properties: {} };
	}
	if (result["type"] === "web_search") {
		for (const field of UNSUPPORTED_WEB_SEARCH_FIELDS) {
			delete result[field];
		}
	}
	return result;
}

/**
 * 归一化 tools 与依附于 tools 的选择参数。
 *
 * xAI 拒绝「没有 tools 却带 tool_choice / parallel_tool_calls」的请求，也拒绝
 * 不支持的 hosted tool，因此过滤后需要同步清理这些字段。
 * @param body - Responses 请求体；原地修改
 * @param model - 上游模型
 */
function normalizeTools(body: Record<string, unknown>, model: string): void {
	const rawTools = body["tools"];
	if (!Array.isArray(rawTools) || rawTools.length === 0) {
		delete body["tools"];
		delete body["tool_choice"];
		delete body["parallel_tool_calls"];
		return;
	}
	const keepImageGeneration = supportsNativeImageGeneration(model);
	const kept: Record<string, unknown>[] = [];
	for (const tool of rawTools) {
		const record = asRecord(tool);
		if (!record) {
			continue;
		}
		const normalized = normalizeTool(record, keepImageGeneration);
		if (normalized) {
			kept.push(normalized);
		}
		if (kept.length >= MAX_TOOLS) {
			break;
		}
	}
	if (kept.length === 0) {
		delete body["tools"];
		delete body["tool_choice"];
		delete body["parallel_tool_calls"];
		return;
	}
	body["tools"] = kept;
}

/**
 * 把一个 `image_url` 字段改写为 xAI 接受的 `url`。
 * @param record - 承载图片引用片段的记录
 */
function moveImageUrl(record: Record<string, unknown>): void {
	const imageUrl = record["image_url"];
	if (imageUrl === undefined) {
		return;
	}
	if (asString(record["url"])) {
		delete record["image_url"];
		return;
	}
	const url = typeof imageUrl === "string" ? imageUrl.trim() : asString(asRecord(imageUrl)?.["url"]);
	if (!url) {
		return;
	}
	record["url"] = url;
	delete record["image_url"];
}

/**
 * 把 `input_image` 的 `image_url` 归一化为 `url`。
 * @param body - Responses 请求体；原地修改
 */
function normalizeImageRefs(body: Record<string, unknown>): void {
	const input = body["input"];
	if (!Array.isArray(input)) {
		return;
	}
	for (const item of input) {
		const record = asRecord(item);
		if (!record) {
			continue;
		}
		moveImageUrl(record);
		const content = record["content"];
		if (!Array.isArray(content)) {
			continue;
		}
		for (const part of content) {
			const partRecord = asRecord(part);
			if (partRecord) {
				moveImageUrl(partRecord);
			}
		}
	}
}

/**
 * 把 Responses 请求体特化为 xAI 形态。
 * @param body - 已按协议翻译的请求体
 * @param model - 上游模型
 * @param stream - 是否流式
 * @param sessionKey - 会话键
 * @returns 上游请求体
 */
function xaiResponsesBody(body: Record<string, unknown>, model: string, stream: boolean, sessionKey: string): Record<string, unknown> {
	const result: Record<string, unknown> = { ...body };
	result["model"] = model;
	result["stream"] = stream;
	// xAI 会解密 reasoning.encrypted_content；跨供应商的 GPT/Claude/DeepSeek
	// 载荷必须连条目删除，否则返回 400 "Could not decrypt"。
	sanitizeXaiResponsesInput(result);
	// xAI Responses API 不接受这些 Chat Completions / Codex 专有字段。
	delete result["previous_response_id"];
	delete result["prompt_cache_retention"];
	delete result["safety_identifier"];
	delete result["stream_options"];
	delete result["stop"];
	normalizeTools(result, model);
	if (sessionKey) {
		result["prompt_cache_key"] = sessionKey;
	}
	normalizeImageRefs(result);
	return result;
}

/**
 * 把 Responses 请求体特化为 compact 形态。
 * @param body - 已按协议翻译的请求体
 * @param model - 上游模型
 * @param previousResponseId - 客户端给出的 `previous_response_id`
 * @returns 上游请求体
 */
function xaiCompactBody(body: Record<string, unknown>, model: string, previousResponseId: string | undefined): Record<string, unknown> {
	const result: Record<string, unknown> = { ...body };
	result["model"] = model;
	// compact 也回放 reasoning，同样要在进入 xAI 前剔除外来加密载荷。
	sanitizeXaiResponsesInput(result);
	// compact 只处理对话历史，不接受生成控制参数。
	delete result["stream"];
	delete result["tools"];
	delete result["tool_choice"];
	delete result["parallel_tool_calls"];
	delete result["previous_response_id"];
	for (const field of ["max_output_tokens", "temperature", "top_p", "top_k", "stop"]) {
		delete result[field];
	}
	if (previousResponseId) {
		result["previous_response_id"] = previousResponseId;
	}
	return result;
}

/**
 * 把一个尺寸或纵横比换算为 xAI 的纵横比。
 * @param value - `aspect_ratio` 或 `size`
 * @returns 纵横比；无法识别时缺省
 */
function imageAspectRatio(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	switch (value.trim().toLowerCase()) {
		case "1:1":
		case "square":
		case "1024x1024":
		case "2048x2048":
			return "1:1";
		case "16:9":
		case "landscape":
		case "1792x1024":
			return "16:9";
		case "9:16":
		case "portrait":
		case "1024x1792":
			return "9:16";
		case "3:2":
			return "3:2";
		case "2:3":
			return "2:3";
		case "4:3":
			return "4:3";
		case "3:4":
			return "3:4";
		case "9:20":
			return "9:20";
		case "20:9":
			return "20:9";
		default:
			return undefined;
	}
}

/**
 * 从 `resolution` 或 `size` 推导分辨率档位。
 * @param resolution - 显式分辨率
 * @param size - 尺寸
 * @returns `1k` / `2k`；无法识别时缺省
 */
function imageResolution(resolution: string | undefined, size: string | undefined): string | undefined {
	const explicit = resolution?.trim().toLowerCase();
	if (explicit === "1k" || explicit === "2k") {
		return explicit;
	}
	if (size && size.toLowerCase().includes("2048")) {
		return "2k";
	}
	return undefined;
}

/**
 * 归一化 `response_format`。
 * @param value - 原始值
 * @returns `url` 或 `b64_json`；无法识别时缺省
 */
function imageResponseFormat(value: unknown): string | undefined {
	const format = asString(value)?.toLowerCase();
	if (format === "url" || format === "b64_json") {
		return format;
	}
	return undefined;
}

/**
 * 归一化 xAI 图片模型别名。
 * @param model - 上游模型名
 * @returns 规范模型名
 */
function imageModel(model: string): string {
	const leaf = modelLeaf(baseModel(model)).toLowerCase();
	if (leaf === "grok-imagine-image-quality" || leaf === "grok-imagine-image-2.0") {
		return leaf;
	}
	return IMAGE_DEFAULT_MODEL;
}

/**
 * 从参考图字段收集图片引用地址。
 * @param value - `image` 或 `images` 字段值
 * @returns 引用地址列表
 */
function collectImageRefs(value: unknown): string[] {
	const urls: string[] = [];
	const push = (candidate: unknown): void => {
		if (typeof candidate === "string" && candidate.trim()) {
			urls.push(candidate.trim());
			return;
		}
		const record = asRecord(candidate);
		if (!record) {
			return;
		}
		const url = asString(record["url"]) ?? asString(record["image_url"]) ?? asString(asRecord(record["image_url"])?.["url"]);
		if (url) {
			urls.push(url);
		}
	};
	if (Array.isArray(value)) {
		for (const item of value) {
			push(item);
		}
		return urls;
	}
	push(value);
	return urls;
}

/**
 * 构造图片生成的上游请求体。
 * @param body - OpenAI images 请求体
 * @param model - 上游模型
 * @returns xAI images 请求体
 * @throws {ApiError} 缺少 prompt 时抛出
 */
function xaiImageBody(body: Record<string, unknown>, model: string): Record<string, unknown> {
	const prompt = asString(body["prompt"]);
	if (!prompt) {
		throw ApiError.badRequest("xAI 图片生成缺少 prompt");
	}
	const size = asString(body["size"]);
	const aspectRatio = imageAspectRatio(asString(body["aspect_ratio"])) ?? imageAspectRatio(size) ?? IMAGE_DEFAULT_ASPECT_RATIO;
	const resolution = imageResolution(asString(body["resolution"]), size) ?? IMAGE_DEFAULT_RESOLUTION;
	const result: Record<string, unknown> = {
		model: imageModel(model),
		prompt: prompt,
		aspect_ratio: aspectRatio,
		resolution: resolution,
	};
	const responseFormat = imageResponseFormat(body["response_format"]);
	if (responseFormat) {
		result["response_format"] = responseFormat;
	}
	const quality = asString(body["quality"]);
	if (quality) {
		result["quality"] = quality;
	}
	const count = asNumber(body["n"]);
	if (count !== undefined && count > 0) {
		result["n"] = Math.trunc(count);
	}
	return result;
}

/**
 * 从 multipart 表单读取文本字段。
 * @param form - 表单
 * @param key - 字段名
 * @returns 字段值；缺失时缺省
 */
function formField(form: FormData, key: string): string | undefined {
	const value = form.get(key);
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * 读取表单中的图片引用。
 *
 * OpenAI images/edits 用 multipart 上传源图；xAI 的 edits 接口只接受 JSON 引用，
 * 因此这里把上传内容编码为 data URL。
 * @param form - 表单
 * @returns 图片引用地址
 */
async function formImageRefs(form: FormData): Promise<string[]> {
	const refs: string[] = [];
	for (const [key, value] of form.entries()) {
		if (key !== "image" && key !== "images") {
			continue;
		}
		if (typeof value === "string") {
			if (value.trim()) {
				refs.push(value.trim());
			}
			continue;
		}
		const buffer = Buffer.from(await value.arrayBuffer());
		if (buffer.byteLength === 0) {
			continue;
		}
		const type = value.type || "image/png";
		refs.push(`data:${type};base64,${buffer.toString("base64")}`);
	}
	return refs;
}

/**
 * 构造图片编辑的上游请求体。
 * @param context - 上游上下文
 * @returns xAI images/edits 请求体
 * @throws {ApiError} 缺少 prompt 或源图时抛出
 */
async function xaiImageEditBody(context: SubscriptionUpstreamContext): Promise<Record<string, unknown>> {
	const form = context.rawBody instanceof FormData ? context.rawBody : undefined;
	const body = form ? {} : asBodyRecord(context.upstreamBody);
	const prompt = form ? formField(form, "prompt") : asString(body["prompt"]);
	if (!prompt) {
		throw ApiError.badRequest("xAI 图片编辑缺少 prompt");
	}
	const formCount = form ? formField(form, "n") : undefined;
	const source: Record<string, unknown> = form
		? {
				prompt: prompt,
				size: formField(form, "size"),
				aspect_ratio: formField(form, "aspect_ratio"),
				resolution: formField(form, "resolution"),
				quality: formField(form, "quality"),
				response_format: formField(form, "response_format"),
				n: formCount === undefined ? undefined : Number(formCount),
			}
		: body;
	const model = (form ? formField(form, "model") : asString(body["model"])) ?? context.model;
	const result = xaiImageBody(source, model);
	const refs = form ? await formImageRefs(form) : [...collectImageRefs(body["image"]), ...collectImageRefs(body["images"])];
	if (refs.length === 0) {
		throw ApiError.badRequest("xAI 图片编辑缺少源图");
	}
	if (refs.length === 1) {
		result["image"] = { type: "image_url", url: refs[0] };
	} else {
		result["images"] = refs.map((url) => ({ type: "image_url", url: url }));
	}
	return result;
}

/**
 * 归一化视频模型别名。
 * @param model - 上游模型名
 * @returns 规范模型名
 */
function videoModel(model: string): string {
	const leaf = modelLeaf(baseModel(model)).toLowerCase();
	switch (leaf) {
		case "grok-imagine-video-1.5":
		case "grok-imagine-video-1.5-preview":
			return "grok-imagine-video-1.5";
		case "grok-imagine-video-1.5-lite":
			return "grok-imagine-video-1.5-lite";
		default:
			return VIDEO_DEFAULT_MODEL;
	}
}

/**
 * 从 OpenAI videos 请求体收集单张输入图。
 * @param body - 请求体
 * @returns 图片地址；缺失时缺省
 */
function videoInputImage(body: Record<string, unknown>): string | undefined {
	for (const key of ["image", "input_reference", "first_frame"]) {
		const value = body[key];
		const direct = asString(value);
		if (direct) {
			return direct;
		}
		const record = asRecord(value);
		if (!record) {
			continue;
		}
		const nested = asString(record["url"]) ?? asString(record["image_url"]) ?? asString(record["file_id"]);
		if (nested) {
			return nested;
		}
	}
	return undefined;
}

/**
 * 构造视频生成的上游请求体。
 * @param body - OpenAI videos 请求体
 * @param model - 上游模型
 * @returns xAI videos 请求体
 * @throws {ApiError} 参数不合法时抛出
 */
function xaiVideoBody(body: Record<string, unknown>, model: string): Record<string, unknown> {
	const prompt = asString(body["prompt"]);
	if (!prompt) {
		throw ApiError.badRequest("xAI 视频生成缺少 prompt");
	}
	const seconds = Number.parseInt(asString(body["seconds"]) ?? VIDEO_DEFAULT_SECONDS, 10);
	if (!Number.isFinite(seconds)) {
		throw ApiError.badRequest("xAI 视频生成要求 seconds 为整数");
	}
	const duration = Math.min(15, Math.max(1, seconds));
	const size = asString(body["size"]) ?? VIDEO_DEFAULT_SIZE;
	const sizeRatio =
		size === "720x1280" || size === "1024x1792" ? "9:16" : size === "1280x720" || size === "1792x1024" ? "16:9" : undefined;
	const aspectRatio = imageAspectRatio(asString(body["aspect_ratio"])) ?? sizeRatio;
	if (!aspectRatio) {
		throw ApiError.badRequest("xAI 视频生成要求 size 为 720x1280、1280x720、1024x1792 或 1792x1024");
	}
	const rawResolution = asString(body["resolution"])?.toLowerCase();
	const resolution =
		rawResolution === "480p" || rawResolution === "720p" || rawResolution === "1080p" ? rawResolution : VIDEO_DEFAULT_RESOLUTION;
	const image = videoInputImage(body);
	const references = collectImageRefs(body["reference_images"]).slice(0, VIDEO_MAX_REFERENCES);
	if (image && references.length > 0) {
		throw ApiError.badRequest("xAI 视频生成不能同时提供 image 与 reference_images");
	}
	const result: Record<string, unknown> = {
		model: videoModel(model),
		prompt: prompt,
		duration: String(duration),
		aspect_ratio: aspectRatio,
		resolution: resolution,
	};
	if (image) {
		result["image"] = { url: image };
	}
	if (references.length > 0) {
		result["reference_images"] = references.map((url) => ({ url: url }));
	}
	return result;
}

/**
 * 把 OpenAI 音色名映射为 Grok 音色。
 * @param voice - 原始音色
 * @returns Grok 音色 ID
 */
function speechVoice(voice: string | undefined): string {
	const normalized = voice?.trim().toLowerCase() ?? "";
	if (!normalized) {
		return SPEECH_DEFAULT_VOICE;
	}
	return OPENAI_SPEECH_VOICES[normalized] ?? normalized;
}

/**
 * 归一化语音合成输出格式。
 * @param body - 请求体
 * @returns 音频格式
 * @throws {ApiError} 格式不受支持时抛出
 */
function speechFormat(body: Record<string, unknown>): "mp3" | "wav" | "pcm" {
	const format = asString(body["response_format"])?.toLowerCase();
	if (!format || format === "mp3") {
		return "mp3";
	}
	if (format === "wav" || format === "pcm") {
		return format;
	}
	throw ApiError.badRequest("xAI 语音合成要求 response_format 为 mp3、wav 或 pcm");
}

/**
 * 归一化语音合成模型。
 * @param model - 公开模型
 * @returns 上游模型
 * @throws {ApiError} 模型不受支持时抛出
 */
function speechModel(model: string): string {
	const leaf = modelLeaf(baseModel(model)).toLowerCase();
	switch (leaf) {
		case "":
		case "tts-1":
		case "tts-1-hd":
		case "gpt-4o-mini-tts":
		case SPEECH_DEFAULT_MODEL:
			return SPEECH_DEFAULT_MODEL;
		case SPEECH_VOICE_MODEL:
			return SPEECH_VOICE_MODEL;
		default:
			throw ApiError.badRequest(`xAI 语音合成不支持模型 ${model}`);
	}
}

/**
 * 构造语音合成的上游请求体。
 * @param body - OpenAI audio/speech 请求体
 * @param model - 公开模型
 * @returns xAI `/tts` 请求体
 * @throws {ApiError} 参数不合法时抛出
 */
function xaiSpeechBody(body: Record<string, unknown>, model: string): Record<string, unknown> {
	const text = asString(body["input"]) ?? asString(body["text"]);
	if (!text) {
		throw ApiError.badRequest("xAI 语音合成缺少 input");
	}
	if ([...text].length > SPEECH_MAX_RUNES) {
		throw ApiError.badRequest("xAI 语音合成的 input 不能超过 60000 个字符");
	}
	const format = speechFormat(body);
	const result: Record<string, unknown> = {
		text: text,
		voice_id: speechVoice(asString(body["voice"]) ?? asString(body["voice_id"])),
		language: asString(body["language"]) ?? "auto",
	};
	const speed = asNumber(body["speed"]);
	if (speed !== undefined && speed > 0) {
		result["speed"] = speed;
	}
	if (format !== "mp3") {
		result["output_format"] = { codec: format, sample_rate: SPEECH_SAMPLE_RATE };
	}
	result["model"] = speechModel(model);
	return result;
}

/**
 * 把 compact 上游响应改写为 Responses 对象。
 *
 * xAI `/responses/compact` 返回 `{object:"response.compaction", id, output, …}`；
 * Codex 客户端期望完整 Responses 形状，这里按 Go 的字段映射补全。
 * @param body - 上游 compact 响应
 * @returns Responses 响应
 */
function convertCompaction(body: Record<string, unknown>): Record<string, unknown> {
	const rawId = asString(body["id"]) ?? "";
	const responseId = rawId.startsWith("resp_") ? rawId : `resp_${rawId.replace(/^cmp_/, "")}`;
	const itemId = responseId.startsWith("resp_") ? `cmp_${responseId.slice("resp_".length)}` : `cmp_${responseId}`;
	const firstOutput = Array.isArray(body["output"]) ? asRecord(body["output"][0]) : undefined;
	const item: Record<string, unknown> = { ...(firstOutput ?? {}) };
	if (item["type"] === undefined) {
		item["type"] = "compaction";
	}
	if (item["id"] === undefined) {
		item["id"] = itemId;
	}
	const createdAt = asNumber(body["created_at"]) ?? Math.floor(Date.now() / 1000);
	const result: Record<string, unknown> = {
		id: responseId,
		object: "response",
		created_at: createdAt,
		status: "completed",
		background: false,
		error: null,
		incomplete_details: null,
		output: [item],
		completed_at: asNumber(body["completed_at"]) ?? createdAt,
	};
	const usage = asRecord(body["usage"]);
	if (usage) {
		result["usage"] = usage;
	}
	const model = asString(body["model"]);
	if (model) {
		result["model"] = model;
	}
	return result;
}

/**
 * 把 `CliProxyAccountQuota` 转换为桥接层额度快照。
 * @param quota - 共享额度层的归一化结果
 * @returns 订阅额度快照
 */
function quotaSnapshot(quota: CliProxyAccountQuota): SubscriptionQuotaSnapshot {
	const windows: SubscriptionQuotaWindow[] = quota.windows.map((window) => ({
		name: window.label || window.id,
		remainingFraction: window.remaining_percent === null ? undefined : window.remaining_percent / 100,
		resetTime: window.resets_at ?? undefined,
	}));
	const balances: Record<string, number> = {};
	for (const balance of quota.balances) {
		balances[balance.label || balance.unit] = balance.limit - balance.used;
	}
	return {
		plan: quota.plan ?? undefined,
		expiresAt: quota.subscription_expires_at ?? undefined,
		balances: balances,
		windows: windows,
		fetchedAt: quota.fetched_at,
	};
}

/**
 * xAI 订阅适配器。
 *
 * 所有入口操作都在进程内完成：`build` 只负责把请求整理为 xAI 上游形态，
 * 上游 HTTP 与响应翻译由桥接层统一执行。
 */
class XaiSubscriptionProvider implements SubscriptionProviderAdapter {
	/** 账号来源。 */
	readonly source = "xai" as const;

	/** 展示名。 */
	readonly displayName = "xAI";

	/** 鉴权处理器。 */
	readonly auth: XaiAuthHandler;

	/** 注入的 fetch；额度查询与测试使用。 */
	private readonly _fetch: typeof fetch;

	/**
	 * @param dependencies - 账号仓库与可选 fetch
	 */
	constructor(dependencies: SubscriptionProviderDependencies) {
		this.auth = createXaiAuth({ accounts: dependencies.accounts, fetch: dependencies.fetch });
		this._fetch = dependencies.fetch ?? fetch;
	}

	/**
	 * 该操作/模型是否由 xAI 承接。
	 *
	 * 媒体操作按模型族判定：图片、视频、语音各有独立上游端点。其余操作
	 * （count_tokens、models、live、realtime、alpha.search）在 Go 里分别由本地分词、
	 * 模型注册表与 WebSocket 通道承担，进程内 HTTP 桥不承接，直接拒绝。
	 * @param operation - 端点操作
	 * @param model - 上游模型
	 */
	supports(operation: SubscriptionOperation, model: string): boolean {
		if (!SUPPORTED_OPERATIONS.has(operation)) {
			return false;
		}
		const leaf = modelLeaf(model).toLowerCase();
		switch (operation) {
			case "images.generations":
			case "images.edits":
				return leaf.includes("image") && !leaf.includes("video");
			case "videos":
				return leaf.includes("video");
			case "speech":
				return leaf.includes("tts");
			default:
				return true;
		}
	}

	/**
	 * 选择上游协议：xAI 统一使用 Responses 语义。
	 * @param _context - 请求上下文
	 */
	route(_context: SubscriptionRequestContext): SubscriptionWireProtocol {
		return "responses";
	}

	/**
	 * 把公开模型映射为上游模型。
	 * @param model - 公开模型 ID
	 */
	resolveModel(model: string): string {
		return baseModel(model);
	}

	/**
	 * 构造上游请求。
	 * @param context - 含凭据与已翻译请求体的上下文
	 */
	async build(context: SubscriptionUpstreamContext): Promise<SubscriptionUpstreamPlan> {
		const credential = context.credential.trim();
		if (!credential) {
			throw ApiError.unavailable("xAI 账号缺少可用凭据");
		}
		switch (context.operation) {
			case "chat":
			case "messages":
			case "responses":
			case "completions":
				return this._buildResponses(context, credential);
			case "compact":
				return this._buildCompact(context, credential);
			case "images.generations":
				return this._buildImageGeneration(context, credential);
			case "images.edits":
				return await this._buildImageEdit(context, credential);
			case "videos":
				return this._buildVideos(context, credential);
			case "speech":
				return this._buildSpeech(context, credential);
			default:
				throw ApiError.badRequest(`xAI 不支持该操作：${context.operation}`);
		}
	}

	/**
	 * 上游响应在翻译前的特化：compact 需要补全 Responses 形状。
	 * @param context - 请求上下文
	 * @param body - 上游 JSON
	 */
	transformUpstreamBody(context: SubscriptionRequestContext, body: Record<string, unknown>): Record<string, unknown> {
		if (context.operation !== "compact") {
			return body;
		}
		return convertCompaction(body);
	}

	/**
	 * 拉取模型目录。
	 */
	async catalog(): Promise<readonly SubscriptionCatalogModel[]> {
		return catalogForSource("xai");
	}

	/**
	 * 查询一个账号的额度。
	 * @param account - 选中账号
	 */
	async quota(account: SubscriptionAccount): Promise<SubscriptionQuotaSnapshot> {
		const credential = await this.auth.ensureCredential(account);
		const quota = await quotaForAccount("xai", account, credential, this._fetch);
		return quotaSnapshot(quota);
	}

	/**
	 * 构造 chat/messages/responses 的上游请求。
	 * @param context - 上游上下文
	 * @param credential - access token
	 */
	private _buildResponses(context: SubscriptionUpstreamContext, credential: string): SubscriptionUpstreamPlan {
		const account = context.account;
		const model = asString(context.upstreamBody["model"]) ?? baseModel(context.model);
		const sessionKey = sessionKeyValue(context.sessionKey);
		const body = xaiResponsesBody(asBodyRecord(context.upstreamBody), model, context.stream, sessionKey);
		const toolNames = normalizeToolNames(body);
		const headers = xaiHeaders(account, credential, context.stream, sessionKey, asString(context.headers["user-agent"]));
		return {
			url: joinUrl(chatBaseUrl(account), "/responses"),
			method: "POST",
			headers: headers,
			body: body,
			bodyEncoding: "json",
			stream: context.stream,
			protocol: "responses",
			model: model,
			...(toolNames === undefined ? {} : { toolNames: toolNames }),
		};
	}

	/**
	 * 构造 compact 的上游请求。
	 * @param context - 上游上下文
	 * @param credential - access token
	 */
	private _buildCompact(context: SubscriptionUpstreamContext, credential: string): SubscriptionUpstreamPlan {
		const account = context.account;
		const model = asString(context.upstreamBody["model"]) ?? baseModel(context.model);
		const previousResponseId = asString(context.body["previous_response_id"]);
		const body = xaiCompactBody(asBodyRecord(context.upstreamBody), model, previousResponseId);
		const headers = xaiHeaders(account, credential, false, sessionKeyValue(context.sessionKey), undefined);
		return {
			url: joinUrl(officialBaseUrl(account), "/responses/compact"),
			method: "POST",
			headers: headers,
			body: body,
			bodyEncoding: "json",
			stream: false,
			protocol: "responses",
			model: model,
		};
	}

	/**
	 * 构造图片生成的上游请求。
	 * @param context - 上游上下文
	 * @param credential - access token
	 */
	private _buildImageGeneration(context: SubscriptionUpstreamContext, credential: string): SubscriptionUpstreamPlan {
		const account = context.account;
		const body = xaiImageBody(asBodyRecord(context.upstreamBody), context.model);
		return {
			url: joinUrl(chatBaseUrl(account), "/images/generations"),
			method: "POST",
			headers: xaiHeaders(account, credential, false, "", undefined),
			body: body,
			bodyEncoding: "json",
			stream: false,
			protocol: "responses",
			model: asString(body["model"]) ?? IMAGE_DEFAULT_MODEL,
		};
	}

	/**
	 * 构造图片编辑的上游请求。
	 * @param context - 上游上下文
	 * @param credential - access token
	 */
	private async _buildImageEdit(context: SubscriptionUpstreamContext, credential: string): Promise<SubscriptionUpstreamPlan> {
		const account = context.account;
		const body = await xaiImageEditBody(context);
		return {
			url: joinUrl(chatBaseUrl(account), "/images/edits"),
			method: "POST",
			headers: xaiHeaders(account, credential, false, "", undefined),
			body: body,
			bodyEncoding: "json",
			stream: false,
			protocol: "responses",
			model: asString(body["model"]) ?? IMAGE_DEFAULT_MODEL,
		};
	}

	/**
	 * 构造视频操作的上游请求：带 `request_id` 时按任务轮询，其余走生成。
	 * @param context - 上游上下文
	 * @param credential - access token
	 */
	private _buildVideos(context: SubscriptionUpstreamContext, credential: string): SubscriptionUpstreamPlan {
		const account = context.account;
		const base = chatBaseUrl(account);
		const headers = xaiHeaders(account, credential, false, "", undefined);
		const action = asString(context.headers["x-litellm-video-action"]) ?? "generations";
		const requestId = action === "generations" ? asString(context.body["request_id"]) : undefined;
		if (requestId) {
			return {
				url: joinUrl(base, `/videos/${encodeURIComponent(requestId)}`),
				method: "GET",
				headers: headers,
				stream: false,
				protocol: "responses",
				model: asString(context.body["model"]) ?? VIDEO_DEFAULT_MODEL,
			};
		}
		const idempotencyKey = asString(context.headers["x-idempotency-key"]);
		if (idempotencyKey) {
			headers["x-idempotency-key"] = idempotencyKey;
		}
		const body =
			action === "edits" || action === "extensions"
				? { ...asBodyRecord(context.body), model: videoModel(context.model) }
				: xaiVideoBody(asBodyRecord(context.body), context.model);
		const path = action === "edits" ? "/videos/edits" : action === "extensions" ? "/videos/extensions" : "/videos/generations";
		return {
			url: joinUrl(base, path),
			method: "POST",
			headers: headers,
			body: body,
			bodyEncoding: "json",
			stream: false,
			protocol: "responses",
			model: asString(body["model"]) ?? VIDEO_DEFAULT_MODEL,
		};
	}

	/**
	 * 构造语音合成的上游请求。
	 * @param context - 上游上下文
	 * @param credential - access token
	 */
	private _buildSpeech(context: SubscriptionUpstreamContext, credential: string): SubscriptionUpstreamPlan {
		const account = context.account;
		const body = xaiSpeechBody(asBodyRecord(context.body), context.model);
		const headers = xaiHeaders(account, credential, false, "", undefined);
		headers["Accept"] = "audio/mpeg";
		return {
			url: joinUrl(officialBaseUrl(account), "/tts"),
			method: "POST",
			headers: headers,
			body: body,
			bodyEncoding: "json",
			stream: false,
			protocol: "responses",
			model: asString(body["model"]) ?? SPEECH_DEFAULT_MODEL,
		};
	}
}

/**
 * 创建 xAI 订阅 Provider 适配器。
 * @param dependencies - 账号仓库与可选 fetch
 * @returns 适配器实例
 */
export function createXaiProvider(dependencies: SubscriptionProviderDependencies): SubscriptionProviderAdapter {
	return new XaiSubscriptionProvider(dependencies);
}
