/**
 * Antigravity 订阅 Provider 适配器。
 *
 * Antigravity 上游是 Google Cloud Code 的私有接口：请求体是 `v1internal` 信封
 * （`{project, request, model, userAgent, requestType, requestId}`），对话内容按
 * Gemini 协议放在 `request` 里，流式用 `?alt=sse`。实现对齐 Go 版
 * `internal/runtime/executor/antigravity_executor*.go`（CLIProxyAPI v8.0.57）：
 * 信封字段、Claude 的 VALIDATED 工具模式、schema 清洗、count_tokens 与额度查询保持同源。
 *
 * 图片、视频、语音、compact 与 WebSocket 通道不在本适配器承接范围：Go 侧
 * `/v1/images/*` 只接受 xAI 与 OpenAI 兼容图片模型，Antigravity 的图片输出通过
 * `gemini-3.1-flash-image` 走对话入口返回 inlineData。
 */

import { createHash, randomUUID } from "node:crypto";
import { ApiError } from "../../../core/api/ApiError";
import type { CliProxyAccountQuota } from "../../../cliproxy/CliProxyTypes";
import { createAntigravityAuth } from "../auth/antigravity";
import { sanitizeAntigravityClaudeSignatures, sanitizeGeminiRequestSignatures } from "../protocol/signatureTargets";
import { normalizeToolNames } from "../toolNames";
import type { SubscriptionAuthHandler } from "../types";
import { ANTIGRAVITY_API_VERSION, ANTIGRAVITY_CLOUDCODE_ENDPOINT, ANTIGRAVITY_USER_AGENT } from "../auth/antigravityConstants";
import { catalogForSource } from "../catalog/catalog";
import { quotaForAccount } from "../quota/quota";
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

/** 信封里的 `userAgent` 固定值。 */
const ENVELOPE_USER_AGENT = "antigravity";

/** 对话类请求的 `requestType`。 */
const REQUEST_TYPE_AGENT = "agent";

/** 图片模型的 `requestType`。 */
const REQUEST_TYPE_IMAGE = "image_gen";

/** 单轮对话缺省会话标记的数量级。 */
const SESSION_ID_MODULUS = 9_000_000_000_000_000_000n;

/** schema 清洗的占位描述（Claude VALIDATED 模式要求非空参数）。 */
const PLACEHOLDER_DESCRIPTION = "Brief explanation of why you are calling this tool";

/** Claude 5.5 系列：上游拒绝强制工具调用，结构化输出改为提示词。 */
const CLAUDE_55_PATTERN = /^claude-(opus|sonnet)-5-5(?:-(high|reasoning))?(?:-[0-9]{8})?(?:\[[^\]]+\])?$/;

/** 需要移动到 description 的约束关键字。 */
const CONSTRAINT_KEYWORDS: readonly string[] = [
	"minLength",
	"maxLength",
	"minimum",
	"maximum",
	"multipleOf",
	"exclusiveMinimum",
	"exclusiveMaximum",
	"pattern",
	"minItems",
	"maxItems",
	"uniqueItems",
	"contains",
	"format",
	"default",
	"examples",
];

/** 上游不识别、需要直接删除的关键字。 */
const UNSUPPORTED_KEYWORDS: readonly string[] = [
	"$schema",
	"$defs",
	"definitions",
	"$id",
	"id",
	"$anchor",
	"$vocabulary",
	"$dynamicRef",
	"$dynamicAnchor",
	"propertyNames",
	"patternProperties",
	"dependentRequired",
	"dependentSchemas",
	"dependencies",
	"if",
	"then",
	"else",
	"$comment",
	"enumDescriptions",
	"enumTitles",
	"prefill",
	"deprecated",
	"encrypted",
	"discriminator",
	"readOnly",
	"writeOnly",
	"additionalItems",
	"unevaluatedProperties",
	"unevaluatedItems",
	"contentSchema",
	"contentMediaType",
	"contentEncoding",
];

/** 本适配器承接的操作。 */
const SUPPORTED_OPERATIONS: ReadonlySet<SubscriptionOperation> = new Set<SubscriptionOperation>([
	"chat",
	"messages",
	"responses",
	"completions",
	"count_tokens",
]);

/** schema 清洗选项。 */
interface SchemaCleanOptions {
	/** 是否为 Claude VALIDATED 工具（补齐非空占位参数）。 */
	readonly addPlaceholder: boolean;
	/** 是否删除工具声明的 title。 */
	readonly removeTitle: boolean;
	/** 是否把多分支联合压成单分支（Claude 侧才需要）。 */
	readonly flattenMultiBranchUnions: boolean;
	/** 是否删除全部 enum 并转成描述（工具参数）。 */
	readonly dropAllEnums: boolean;
	/** 是否只删除布尔 enum（响应 schema）。 */
	readonly dropBooleanEnums: boolean;
	/** 是否保留 `additionalProperties: false`（响应 schema 上游原生支持）。 */
	readonly preserveAdditionalPropertiesFalse: boolean;
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
		throw ApiError.badRequest("Antigravity 请求缺少模型 ID");
	}
	const suffix = trimmed.lastIndexOf("(");
	if (suffix > 0 && trimmed.endsWith(")")) {
		return trimmed.slice(0, suffix).trim();
	}
	return trimmed;
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
 * 是否为 Claude 模型。
 * @param model - 上游模型
 */
function isClaudeModel(model: string): boolean {
	return model.toLowerCase().includes("claude");
}

/**
 * 是否为需要写占位参数的 Antigravity schema 通道。
 *
 * 与 Go 一致：Claude 与 gemini-3-pro / gemini-3.1-pro 使用 Antigravity schema 语义，
 * 其余 Gemini 模型沿用 Gemini schema 清洗。
 * @param model - 上游模型
 */
function usesAntigravitySchema(model: string): boolean {
	const name = model.toLowerCase();
	return isClaudeModel(name) || name.includes("gemini-3-pro") || name.includes("gemini-3.1-pro");
}

/**
 * 读取账号上的 project_id。
 * @param account - 账号
 * @returns project_id；缺失时缺省
 */
function projectId(account: SubscriptionAccount): string | undefined {
	return asString(account.raw["project_id"]) ?? asString(account.raw["projectId"]);
}

/**
 * 计算上游基础地址：账号显式配置优先，否则使用 daily Cloud Code 端点。
 * @param account - 账号
 * @returns 基础地址
 */
function baseUrl(account: SubscriptionAccount): string {
	const configured = asString(account.raw["base_url"]);
	if (configured) {
		return configured.replace(/\/+$/, "");
	}
	return ANTIGRAVITY_CLOUDCODE_ENDPOINT;
}

/**
 * 计算上游 User-Agent。
 * @param account - 账号
 * @returns User-Agent
 */
function userAgent(account: SubscriptionAccount): string {
	return asString(account.raw["user_agent"]) ?? ANTIGRAVITY_USER_AGENT;
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
 * 构造 Antigravity 请求头。
 *
 * 账号上配置的自定义头最后合并，允许覆盖默认 User-Agent（对齐 Go 的
 * `ApplyCustomHeadersFromAttrs` 顺序）。
 * @param account - 账号
 * @param credential - access token
 * @returns 请求头
 */
function antigravityHeaders(account: SubscriptionAccount, credential: string): Record<string, string> {
	return {
		"Content-Type": "application/json",
		Authorization: `Bearer ${credential}`,
		"User-Agent": userAgent(account),
		...configuredHeaders(account),
	};
}

/**
 * 由会话键派生稳定的 sessionId。
 *
 * 上游要求 `request.sessionId` 形如 `-<数字>`；同一客户端会话必须稳定，否则
 * 上游会把每次请求当成新对话。没有会话键时退回随机值。
 * @param sessionKey - 桥接层会话键
 * @returns sessionId
 */
function sessionId(sessionKey: string): string {
	const trimmed = sessionKey.trim();
	if (!trimmed) {
		const random = BigInt(`0x${randomUUID().replace(/-/g, "")}`);
		return `-${random % SESSION_ID_MODULUS}`;
	}
	const digest = createHash("sha256").update(trimmed).digest("hex").slice(0, 16);
	return `-${BigInt(`0x${digest}`) % SESSION_ID_MODULUS}`;
}

/**
 * 在 description 后追加提示文本。
 * @param schema - 目标 schema 节点；原地修改
 * @param hint - 提示文本
 */
function appendHint(schema: Record<string, unknown>, hint: string): void {
	const existing = asString(schema["description"]);
	schema["description"] = existing ? `${existing} (${hint})` : hint;
}

/**
 * 把本地 `$ref` 解析为内联 schema。
 * @param node - 待处理 schema
 * @param options - 清洗选项
 * @param defs - 顶层 `$defs` / `definitions`
 * @param depth - 当前递归深度
 * @returns 清洗后的 schema；无法解析时缺省
 */
function cleanSchema(
	node: unknown,
	options: SchemaCleanOptions,
	defs: Record<string, unknown>,
	depth: number,
): Record<string, unknown> | undefined {
	if (depth > 16) {
		return undefined;
	}
	const record = asRecord(node);
	if (!record) {
		return undefined;
	}
	let source: Record<string, unknown> = record;
	const ref = asString(record["$ref"]);
	if (ref) {
		const resolved = resolveLocalRef(ref, defs);
		const cleanedRef = resolved ? cleanSchema(resolved, options, defs, depth + 1) : undefined;
		if (!cleanedRef) {
			const fallback: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(record)) {
				if (key !== "$ref") {
					fallback[key] = value;
				}
			}
			appendHint(fallback, `$ref: ${ref}`);
			source = fallback;
		} else {
			source = { ...cleanedRef, ...record };
			delete source["$ref"];
		}
	}
	const result: Record<string, unknown> = { ...source };

	if (result["const"] !== undefined) {
		result["enum"] = [result["const"]];
		delete result["const"];
	}

	mergeAllOf(result, options, defs, depth);
	flattenUnions(result, options, defs, depth);
	flattenTypeAxis(result);

	// 上游不支持 `not`；把它转成描述，避免约束信息静默丢失。
	const negated = result["not"];
	if (negated !== undefined) {
		appendHint(result, `not: ${typeof negated === "string" ? negated : JSON.stringify(negated)}`);
		delete result["not"];
	}

	for (const keyword of CONSTRAINT_KEYWORDS) {
		const value = result[keyword];
		if (value === undefined) {
			continue;
		}
		appendHint(result, `${keyword}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
		delete result[keyword];
	}

	const enumValues = result["enum"];
	if (Array.isArray(enumValues)) {
		const dropAll = options.dropAllEnums;
		const dropBoolean = options.dropBooleanEnums && enumValues.every((value) => typeof value === "boolean");
		if (dropAll || dropBoolean) {
			appendHint(result, `allowed values: ${enumValues.map((value) => String(value)).join(", ")}`);
			delete result["enum"];
		}
	}

	for (const keyword of UNSUPPORTED_KEYWORDS) {
		delete result[keyword];
	}
	if (options.removeTitle) {
		delete result["title"];
	}
	const additional = result["additionalProperties"];
	if (additional !== undefined) {
		if (!(options.preserveAdditionalPropertiesFalse && additional === false)) {
			delete result["additionalProperties"];
		}
	}

	const properties = asRecord(result["properties"]);
	if (properties) {
		const cleanedProperties: Record<string, unknown> = {};
		for (const [name, child] of Object.entries(properties)) {
			const cleanedChild = cleanSchema(child, options, defs, depth + 1);
			cleanedProperties[name] = cleanedChild ?? child;
		}
		result["properties"] = cleanedProperties;
		if (result["type"] === undefined) {
			result["type"] = "object";
		}
	}
	const required = result["required"];
	if (Array.isArray(required)) {
		const kept = required.filter((name) => typeof name === "string" && (!properties || name in properties));
		if (kept.length > 0) {
			result["required"] = kept;
		} else {
			delete result["required"];
		}
	}

	const items = result["items"];
	if (items !== undefined) {
		const cleanedItems = cleanSchema(items, options, defs, depth + 1);
		if (cleanedItems) {
			result["items"] = cleanedItems;
		}
		if (result["type"] === undefined) {
			result["type"] = "array";
		}
	} else if (result["type"] === "array") {
		result["items"] = { type: "string" };
	}

	if (options.addPlaceholder && result["type"] === "object") {
		const currentProperties = asRecord(result["properties"]);
		const needsPlaceholder =
			currentProperties === undefined || Object.keys(currentProperties).length === 0;
		if (needsPlaceholder) {
			result["properties"] = {
				...(currentProperties ?? {}),
				reason: { type: "string", description: PLACEHOLDER_DESCRIPTION },
			};
			result["required"] = ["reason"];
		}
	}

	return result;
}

/**
 * 解析本地 `$ref`。
 * @param ref - `#/$defs/Name` 或 `#/definitions/Name`
 * @param defs - 顶层定义表
 * @returns 目标 schema；无法解析时缺省
 */
function resolveLocalRef(ref: string, defs: Record<string, unknown>): Record<string, unknown> | undefined {
	if (!ref.startsWith("#/")) {
		return undefined;
	}
	const segments = ref
		.slice(2)
		.split("/")
		.map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
	// `defs` 传的是顶层 `$defs` 表本身；ref 仍以 `#/$defs/...` 开头。
	if (segments[0] === "$defs" || segments[0] === "definitions") {
		segments.shift();
	}
	let current: unknown = defs;
	for (const segment of segments) {
		const record = asRecord(current);
		if (!record) {
			return undefined;
		}
		current = record[segment];
	}
	return asRecord(current);
}

/**
 * 展开 `allOf`：合并子 schema 的 properties 与 required。
 * @param result - 目标 schema；原地修改
 * @param options - 清洗选项
 * @param defs - 顶层定义表
 * @param depth - 当前递归深度
 */
function mergeAllOf(
	result: Record<string, unknown>,
	options: SchemaCleanOptions,
	defs: Record<string, unknown>,
	depth: number,
): void {
	const allOf = result["allOf"];
	if (!Array.isArray(allOf)) {
		return;
	}
	delete result["allOf"];
	for (const branch of allOf) {
		const cleaned = cleanSchema(branch, options, defs, depth + 1);
		if (!cleaned) {
			continue;
		}
		for (const [key, value] of Object.entries(cleaned)) {
			if (key === "properties") {
				const merged = asRecord(value);
				if (!merged) {
					continue;
				}
				const current = asRecord(result["properties"]) ?? {};
				result["properties"] = { ...current, ...merged };
				continue;
			}
			if (key === "required" && Array.isArray(value)) {
				const current = Array.isArray(result["required"]) ? (result["required"] as unknown[]) : [];
				const merged = [...current];
				for (const name of value) {
					if (!merged.includes(name)) {
						merged.push(name);
					}
				}
				result["required"] = merged;
				continue;
			}
			if (result[key] === undefined) {
				result[key] = value;
			}
		}
	}
}

/**
 * 展开 `anyOf` / `oneOf`。
 *
 * 单类型可空联合（`[T, null]`）合并为 `T + nullable`；多分支联合仅在 Claude 工具
 * 或上游不接受联合时才压成单分支，其余情况保留清洗后的分支。
 * @param result - 目标 schema；原地修改
 * @param options - 清洗选项
 * @param defs - 顶层定义表
 * @param depth - 当前递归深度
 */
function flattenUnions(
	result: Record<string, unknown>,
	options: SchemaCleanOptions,
	defs: Record<string, unknown>,
	depth: number,
): void {
	for (const keyword of ["anyOf", "oneOf"]) {
		const branches = result[keyword];
		if (!Array.isArray(branches)) {
			continue;
		}
		delete result[keyword];
		const cleaned: Record<string, unknown>[] = [];
		let nullable = false;
		for (const branch of branches) {
			const candidate = cleanSchema(branch, options, defs, depth + 1);
			if (!candidate) {
				continue;
			}
			if (candidate["type"] === "null") {
				nullable = true;
				continue;
			}
			cleaned.push(candidate);
		}
		if (nullable) {
			result["nullable"] = true;
		}
		if (cleaned.length === 0) {
			continue;
		}
		if (cleaned.length === 1 || options.flattenMultiBranchUnions) {
			const first = cleaned[0];
			if (first) {
				for (const [key, value] of Object.entries(first)) {
					if (result[key] === undefined) {
						result[key] = value;
					}
				}
			}
			continue;
		}
		result[keyword] = cleaned;
	}
}

/**
 * 把 `type` 数组压成单类型。
 * @param result - 目标 schema；原地修改
 */
function flattenTypeAxis(result: Record<string, unknown>): void {
	const type = result["type"];
	if (!Array.isArray(type)) {
		return;
	}
	const remaining = type.filter((entry) => entry !== "null");
	if (remaining.length !== type.length) {
		result["nullable"] = true;
	}
	const first = remaining[0];
	if (typeof first === "string") {
		result["type"] = first;
		return;
	}
	delete result["type"];
}

/**
 * 清洗一个工具参数 schema。
 * @param schema - 原始 schema
 * @param claude - 是否按 Claude 工具清洗
 * @param requirePlaceholder - 是否补齐非空占位参数
 * @returns 清洗后的 schema
 */
function cleanToolSchema(schema: Record<string, unknown>, claude: boolean, requirePlaceholder: boolean): Record<string, unknown> {
	const options: SchemaCleanOptions = {
		addPlaceholder: requirePlaceholder,
		removeTitle: !requirePlaceholder,
		flattenMultiBranchUnions: claude,
		dropAllEnums: true,
		dropBooleanEnums: false,
		preserveAdditionalPropertiesFalse: false,
	};
	const defs = asRecord(schema["$defs"]) ?? asRecord(schema["definitions"]) ?? {};
	return cleanSchema(schema, options, defs, 0) ?? schema;
}

/**
 * 清洗一个响应 schema（结构化输出契约）。
 * @param schema - 原始 schema
 * @returns 清洗后的 schema
 */
function cleanResponseSchema(schema: Record<string, unknown>): Record<string, unknown> {
	const options: SchemaCleanOptions = {
		addPlaceholder: false,
		removeTitle: true,
		flattenMultiBranchUnions: false,
		dropAllEnums: false,
		dropBooleanEnums: true,
		preserveAdditionalPropertiesFalse: true,
	};
	const defs = asRecord(schema["$defs"]) ?? asRecord(schema["definitions"]) ?? {};
	return cleanSchema(schema, options, defs, 0) ?? schema;
}

/**
 * 清洗 `request.tools` 中的声明 schema。
 * @param tools - 工具列表；原地修改
 * @param model - 上游模型
 */
function sanitizeToolSchemas(tools: unknown, model: string): void {
	if (!Array.isArray(tools)) {
		return;
	}
	const claude = isClaudeModel(model);
	const requirePlaceholder = usesAntigravitySchema(model);
	for (const tool of tools) {
		const record = asRecord(tool);
		if (!record) {
			continue;
		}
		const declarations = record["functionDeclarations"] ?? record["function_declarations"];
		if (!Array.isArray(declarations)) {
			continue;
		}
		for (const declaration of declarations) {
			const decl = asRecord(declaration);
			if (!decl) {
				continue;
			}
			const renamed = decl["parametersJsonSchema"];
			if (renamed !== undefined && decl["parameters"] === undefined) {
				decl["parameters"] = renamed;
				delete decl["parametersJsonSchema"];
			}
			for (const key of ["parameters", "parametersJsonSchema", "response"]) {
				const schema = asRecord(decl[key]);
				if (!schema) {
					continue;
				}
				decl[key] = cleanToolSchema(schema, claude, key === "response" ? false : requirePlaceholder);
			}
		}
	}
}

/**
 * 清洗 `request.generationConfig` 中的响应 schema。
 * @param generationConfig - 生成配置；原地修改
 */
function sanitizeGenerationSchemas(generationConfig: Record<string, unknown>): void {
	for (const key of ["responseSchema", "responseJsonSchema", "response_schema", "response_json_schema"]) {
		const schema = asRecord(generationConfig[key]);
		if (!schema) {
			continue;
		}
		generationConfig["responseSchema"] = cleanResponseSchema(schema);
		if (key !== "responseSchema") {
			delete generationConfig[key];
		}
	}
}

/**
 * 构造结构化输出提示词。
 * @param name - schema 名称
 * @param description - schema 描述
 * @param schema - schema 内容
 * @returns 系统提示文本
 */
function structuredOutputInstruction(name: string | undefined, description: string | undefined, schema: Record<string, unknown>): string {
	const parts: string[] = [
		"You must format your entire response as valid JSON that conforms strictly to the following JSON schema:",
	];
	if (name) {
		parts.push(`Schema Name: ${name}`);
	}
	if (description) {
		parts.push(`Schema Description: ${description}`);
	}
	parts.push("JSON Schema:");
	parts.push(JSON.stringify(schema));
	parts.push(
		"Do not include any explanations, markdown code blocks (such as ```json), or any text outside of the JSON object.",
	);
	return parts.join("\n");
}

/**
 * Claude 5.5 的结构化输出改写：把原生 responseSchema 变成系统提示。
 *
 * 上游对 Claude 5.5 拒绝强制工具调用（ANY/VALIDATED），因此这里按 Go 的做法把
 * schema 移入 systemInstruction，并清掉原生输出叶子。
 * @param request - 信封内的 request；原地修改
 * @param model - 上游模型
 * @returns 是否完成改写
 */
function prepareClaudeStructuredOutput(request: Record<string, unknown>, model: string): boolean {
	if (!CLAUDE_55_PATTERN.test(model.toLowerCase())) {
		return false;
	}
	const generationConfig = asRecord(request["generationConfig"]) ?? asRecord(request["generation_config"]);
	if (!generationConfig) {
		return false;
	}
	let schema: Record<string, unknown> | undefined;
	for (const key of ["responseSchema", "responseJsonSchema", "response_schema", "response_json_schema"]) {
		const candidate = asRecord(generationConfig[key]);
		if (candidate) {
			schema = candidate;
			break;
		}
	}
	if (!schema) {
		return false;
	}
	const instruction = structuredOutputInstruction(
		asString(schema["name"]),
		asString(schema["description"]),
		schema,
	);
	for (const key of ["responseSchema", "responseJsonSchema", "response_schema", "response_json_schema", "responseMimeType", "response_mime_type"]) {
		delete generationConfig[key];
	}
	const system = asRecord(request["systemInstruction"]) ?? { role: "user", parts: [] };
	const parts = Array.isArray(system["parts"]) ? (system["parts"] as unknown[]) : [];
	system["parts"] = [...parts, { text: instruction }];
	request["systemInstruction"] = system;
	delete request["system_instruction"];
	const toolConfig = asRecord(request["toolConfig"]) ?? asRecord(request["tool_config"]);
	const functionCalling = asRecord(toolConfig?.["functionCallingConfig"]) ?? asRecord(toolConfig?.["function_calling_config"]);
	if (toolConfig && functionCalling) {
		const mode = asString(functionCalling["mode"])?.toUpperCase();
		if (mode === "ANY" || mode === "VALIDATED") {
			functionCalling["mode"] = "AUTO";
			delete functionCalling["allowedFunctionNames"];
			delete functionCalling["allowed_function_names"];
		}
	}
	return true;
}

/**
 * 读取目录中某个模型的最大输出 token。
 * @param model - 上游模型
 * @returns 上限；未知时缺省
 */
function catalogMaxOutputTokens(model: string): number | undefined {
	const entry = catalogForSource("antigravity").find((candidate) => candidate.id === model);
	const value = asNumber(entry?.metadata?.["maxOutputTokens"]);
	return value !== undefined && value > 0 ? value : undefined;
}

/**
 * 把 Gemini 请求体归一化为上游可接受的键名。
 *
 * 翻译器可能产出 snake_case 别名；上游信封只接受 camelCase。`safetySettings`
 * 由 Antigravity 端统一管理，请求里的同名字段会被上游拒绝。
 * @param request - 信封内的 request；原地修改
 */
function normalizeRequestKeys(request: Record<string, unknown>): void {
	if (request["system_instruction"] !== undefined && request["systemInstruction"] === undefined) {
		request["systemInstruction"] = request["system_instruction"];
	}
	delete request["system_instruction"];
	if (request["generation_config"] !== undefined && request["generationConfig"] === undefined) {
		request["generationConfig"] = request["generation_config"];
	}
	delete request["generation_config"];
	delete request["safetySettings"];
}

/**
 * 构造 Antigravity 上游请求体（`v1internal` 信封）。
 * @param context - 上游上下文
 * @param model - 上游模型
 * @param project - Cloud Code 项目 ID
 * @returns 信封请求体
 * @throws {ApiError} 缺少 project_id 时抛出
 */
function envelopeBody(context: SubscriptionUpstreamContext, model: string, project: string): Record<string, unknown> {
	const upstream = asBodyRecord(context.upstreamBody);
	const inner = asRecord(upstream["request"]) ?? upstream;
	const request: Record<string, unknown> = { ...inner };
	for (const key of ["model", "project", "requestType", "requestId", "userAgent", "request"]) {
		delete request[key];
	}
	normalizeRequestKeys(request);
	// Antigravity 的 Claude 腿接收 Claude 签名，不能套用 Gemini 的 bypass
	// sentinel；Gemini 腿才走 functionCall 回放约束。
	if (isClaudeModel(model)) {
		sanitizeAntigravityClaudeSignatures(request);
	} else {
		sanitizeGeminiRequestSignatures(request);
	}
	const toolConfig = asRecord(upstream["toolConfig"]) ?? asRecord(upstream["tool_config"]);
	if (toolConfig && asRecord(request["toolConfig"]) === undefined) {
		request["toolConfig"] = toolConfig;
	}
	delete request["tool_config"];

	const generationConfig = asRecord(request["generationConfig"]);
	if (generationConfig) {
		sanitizeGenerationSchemas(generationConfig);
		const maxOutput = asNumber(generationConfig["maxOutputTokens"]);
		const limit = catalogMaxOutputTokens(model);
		if (maxOutput !== undefined && limit !== undefined && maxOutput > limit) {
			generationConfig["maxOutputTokens"] = limit;
		}
	}
	sanitizeToolSchemas(request["tools"], model);

	const claude = isClaudeModel(model);
	const structured = prepareClaudeStructuredOutput(request, model);
	if (claude) {
		if (!structured) {
			const config = asRecord(request["toolConfig"]) ?? {};
			const functionCalling = asRecord(config["functionCallingConfig"]) ?? {};
			functionCalling["mode"] = "VALIDATED";
			config["functionCallingConfig"] = functionCalling;
			request["toolConfig"] = config;
		}
	} else if (generationConfig) {
		delete generationConfig["maxOutputTokens"];
	}

	request["sessionId"] = sessionId(context.sessionKey);

	// 对话入口也可能带图片模型（如 gemini-3.1-flash-image）：上游按 image_gen 记账，
	// 但请求仍走 generateContent，所以这里只改类型与 requestId 前缀。
	const imageModel = model.toLowerCase().includes("image");
	return {
		project: project,
		request: request,
		model: model,
		userAgent: ENVELOPE_USER_AGENT,
		requestType: imageModel ? REQUEST_TYPE_IMAGE : REQUEST_TYPE_AGENT,
		requestId: imageModel ? `image_gen/${Date.now()}/${randomUUID()}/12` : `agent-${randomUUID()}`,
	};
}

/**
 * 构造 count_tokens 的上游请求体：信封中只保留 `request`。
 * @param context - 上游上下文
 * @returns countTokens 请求体
 */
function countTokensBody(context: SubscriptionUpstreamContext): Record<string, unknown> {
	const upstream = asBodyRecord(context.upstreamBody);
	const inner = asRecord(upstream["request"]) ?? upstream;
	const request: Record<string, unknown> = { ...inner };
	for (const key of [
		"model",
		"project",
		"requestType",
		"requestId",
		"userAgent",
		"safetySettings",
		"toolConfig",
		"labels",
		"sessionId",
	]) {
		delete request[key];
	}
	return { request: request };
}

/**
 * 把上游 `{totalTokens}` 归一化为入口协议的计数响应。
 * @param context - 请求上下文
 * @param body - 上游 JSON
 * @returns 计数响应
 */
function countTokensResult(context: SubscriptionRequestContext, body: Record<string, unknown>): Record<string, unknown> {
	const total = asNumber(body["totalTokens"]) ?? asNumber(asRecord(body["usageMetadata"])?.["totalTokenCount"]) ?? 0;
	if (context.inbound === "messages") {
		return { input_tokens: total };
	}
	return { input_tokens: total, total_tokens: total };
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
 * Antigravity 订阅适配器。
 *
 * `route` 固定返回 `gemini`：桥接层把入口协议翻译成 Gemini 请求体，
 * `build` 再套上 Cloud Code 的 `v1internal` 信封。
 */
class AntigravitySubscriptionProvider implements SubscriptionProviderAdapter {
	/** 账号来源。 */
	readonly source = "antigravity" as const;

	/** 展示名。 */
	readonly displayName = "Antigravity";

	/** 鉴权处理器。 */
	readonly auth: SubscriptionAuthHandler;

	/** 注入的 fetch；额度查询与测试使用。 */
	private readonly _fetch: typeof fetch;

	/**
	 * @param dependencies - 账号仓库与可选 fetch
	 */
	constructor(dependencies: SubscriptionProviderDependencies) {
		this.auth = createAntigravityAuth({ accounts: dependencies.accounts, fetch: dependencies.fetch });
		this._fetch = dependencies.fetch ?? fetch;
	}

	/**
	 * 该操作/模型是否由 Antigravity 承接。
	 * @param operation - 端点操作
	 * @param _model - 上游模型
	 */
	supports(operation: SubscriptionOperation, _model: string): boolean {
		return SUPPORTED_OPERATIONS.has(operation);
	}

	/**
	 * 选择上游协议：Antigravity 使用 Google 私有 gemini 信封。
	 * @param _context - 请求上下文
	 */
	route(_context: SubscriptionRequestContext): SubscriptionWireProtocol {
		return "gemini";
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
			throw ApiError.unavailable("Antigravity 账号缺少可用凭据");
		}
		const project = projectId(context.account);
		if (!project) {
			throw ApiError.unavailable("Antigravity 账号缺少 project_id，请重新登录");
		}
		const model = baseModel(context.model);
		const base = baseUrl(context.account);
		const headers = antigravityHeaders(context.account, credential);
		if (context.operation === "count_tokens") {
			// 计数端点不承载对话：协议固定为入口协议，避免把计数结果当对话翻译。
			return {
				url: joinUrl(base, `/${ANTIGRAVITY_API_VERSION}:countTokens`),
				method: "POST",
				headers: headers,
				body: countTokensBody(context),
				bodyEncoding: "json",
				stream: false,
				protocol: context.inbound,
				model: model,
			};
		}
		if (!SUPPORTED_OPERATIONS.has(context.operation)) {
			throw ApiError.badRequest(`${this.displayName} 不支持该操作：${context.operation}`);
		}
		const body = envelopeBody(context, model, project);
		const toolNames = normalizeToolNames(body);
		const path = context.stream
			? `/${ANTIGRAVITY_API_VERSION}:streamGenerateContent?alt=sse`
			: `/${ANTIGRAVITY_API_VERSION}:generateContent`;
		return {
			url: joinUrl(base, path),
			method: "POST",
			headers: context.stream ? { ...headers, Accept: "text/event-stream" } : headers,
			body: body,
			bodyEncoding: "json",
			stream: context.stream,
			protocol: "gemini",
			model: model,
			...(toolNames === undefined ? {} : { toolNames: toolNames }),
		};
	}

	/**
	 * 上游响应在翻译前的特化：拆掉 Cloud Code 的 `response` 信封。
	 * @param context - 请求上下文
	 * @param body - 上游 JSON
	 */
	transformUpstreamBody(
		context: SubscriptionRequestContext,
		body: Record<string, unknown>,
	): Record<string, unknown> {
		if (context.operation === "count_tokens") {
			return countTokensResult(context, body);
		}
		const inner = asRecord(body["response"]);
		return inner ?? body;
	}

	/**
	 * 上游 SSE 事件在翻译前的特化：逐条拆掉 `response` 信封。
	 * @param _context - 请求上下文
	 * @param event - 上游事件
	 */
	transformUpstreamEvent(
		_context: SubscriptionRequestContext,
		event: Record<string, unknown>,
	): Record<string, unknown> | null {
		const inner = asRecord(event["response"]);
		return inner ?? event;
	}

	/**
	 * 拉取模型目录。
	 */
	async catalog(): Promise<readonly SubscriptionCatalogModel[]> {
		return catalogForSource("antigravity");
	}

	/**
	 * 查询一个账号的额度。
	 * @param account - 选中账号
	 */
	async quota(account: SubscriptionAccount): Promise<SubscriptionQuotaSnapshot> {
		const credential = await this.auth.ensureCredential(account);
		const quota = await quotaForAccount("antigravity", account, credential, this._fetch);
		return quotaSnapshot(quota);
	}
}

/**
 * 创建 Antigravity 订阅 Provider 适配器。
 * @param dependencies - 账号仓库与可选 fetch
 * @returns 适配器实例
 */
export function createAntigravityProvider(dependencies: SubscriptionProviderDependencies): SubscriptionProviderAdapter {
	return new AntigravitySubscriptionProvider(dependencies);
}
