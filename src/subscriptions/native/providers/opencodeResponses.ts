/**
 * OpenCode Go Responses 路由的工具与历史条目处理。
 *
 * 非 GPT 家族的 Responses 上游不接受 namespace 工具、custom 工具与历史推理
 * 条目：插件把命名空间展开成 `namespace__name` 形式的 function 工具，返回
 * 路径再按登记表还原。这里保持同样的规则；登记表由适配器按请求保存，避免把
 * 展开后的名字泄漏给客户端。
 */

import { createHash } from "node:crypto";
import { ApiError } from "../../../core/api/ApiError";

/** 一个展开后的工具标识。 */
export interface ResponseToolIdentity {
	/** 原始工具名。 */
	readonly name: string;
	/** 原始命名空间；普通工具缺省。 */
	readonly namespace?: string;
	/** 是否由 custom 工具展开。 */
	readonly isCustom: boolean;
}

/** 一次请求的工具登记表。 */
export interface ResponseToolRegistry {
	/** 扁平工具名 → 原始标识。 */
	readonly identities: Map<string, ResponseToolIdentity>;
	/** 已确认的 custom 工具条目 ID（`item_id` / `call_id`）。 */
	readonly customItems: Set<string>;
}

/** Responses 请求规范化选项。 */
export interface NormalizeResponsesOptions {
	/** 是否展开工具命名空间；GPT 家族原生支持 Responses 工具，保持原样。 */
	readonly flattenTools: boolean;
}

/** Responses 请求规范化结果。 */
export interface NormalizedResponsesRequest {
	/** 已完成 provider 特化的上游请求体。 */
	readonly body: Record<string, unknown>;
	/** 本次请求的工具登记表；GPT 家族为空表。 */
	readonly registry: ResponseToolRegistry;
}

/** Responses 响应还原选项。 */
export interface RestoreResponsesOptions {
	/** 是否还原 custom 工具的条目形状；仅入口协议为 Responses 时开启。 */
	readonly restoreCustom: boolean;
}

/** 工具名最大长度。 */
const MAX_TOOL_NAME_LENGTH = 64;
/** 截断时保留的原始字符数。 */
const TRUNCATED_NAME_LENGTH = 50;
/** 截断后追加的摘要长度（十六进制字符）。 */
const DIGEST_LENGTH = 12;
/** custom 工具输入字段的展开顺序。 */
const CUSTOM_INPUT_KEYS: readonly string[] = ["input", "code", "arguments", "cmd", "command"];
/** 无参数工具的空对象 schema。 */
const EMPTY_OBJECT_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
	type: "object",
	properties: {},
	additionalProperties: true,
});

/**
 * 创建空工具登记表。
 * @returns 可写的登记表
 */
export function createResponseToolRegistry(): ResponseToolRegistry {
	return { identities: new Map(), customItems: new Set() };
}

/**
 * 展开一个命名空间子工具。
 *
 * 名字超过 64 个字符时截断为前 50 个字符加 `__` 加 SHA-256 摘要的前 12 位，
 * 与插件 `qualifiedToolName` 一致。
 * @param name - 子工具名
 * @param namespace - 命名空间
 * @returns 上游使用的扁平工具名
 */
export function flattenToolName(name: string, namespace: string): string {
	const qualified = `${namespace}__${name}`;
	if (qualified.length <= MAX_TOOL_NAME_LENGTH) {
		return qualified;
	}
	const digest = createHash("sha256").update(qualified).digest("hex").slice(0, DIGEST_LENGTH);
	return `${qualified.slice(0, TRUNCATED_NAME_LENGTH)}__${digest}`;
}

/**
 * 从 custom 工具的参数字符串里取出原始输入。
 *
 * 参数是对象时按 `input` / `code` / `arguments` / `cmd` / `command` 的顺序
 * 取第一个字段；单键对象取该键；字符串值直接返回，其它值保留 JSON 文本。
 * 无法识别时原样返回参数字符串。
 * @param args - `arguments` 字段
 * @returns 客户端可读的 custom 工具输入
 */
export function unwrapCustomToolInput(args: unknown): string {
	if (typeof args !== "string") {
		return "";
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(args) as unknown;
	} catch {
		return args;
	}
	const record = asRecord(parsed);
	if (!record) {
		return args;
	}
	for (const key of CUSTOM_INPUT_KEYS) {
		if (Object.hasOwn(record, key)) {
			return stringifyCustomInput(record[key]);
		}
	}
	const keys = Object.keys(record);
	const onlyKey = keys[0];
	if (keys.length === 1 && onlyKey !== undefined) {
		const value = record[onlyKey];
		if (typeof value === "string") {
			return value;
		}
	}
	return args;
}

/**
 * 规范化一个 Responses 请求体。
 *
 * 非 GPT 目标会合并 `additional_tools`、展开命名空间工具、改写 custom 工具与
 * 历史调用条目，并丢弃上游拒绝的历史推理/压缩条目；GPT 目标只改写模型。
 * @param body - 已翻译的 Responses 请求体
 * @param upstreamModel - 上游模型 ID
 * @param options - 规范化选项
 * @returns 上游请求体与工具登记表
 * @throws ApiError 工具声明非法或展开后名字冲突时抛出
 */
export function normalizeResponsesRequest(
	body: Record<string, unknown>,
	upstreamModel: string,
	options: NormalizeResponsesOptions,
): NormalizedResponsesRequest {
	const cloned = asRecord(cloneJsonValue(body));
	if (!cloned) {
		throw ApiError.badRequest("Responses 请求体必须是 JSON 对象");
	}
	const registry = createResponseToolRegistry();
	if (options.flattenTools) {
		normalizeResponseBody(cloned, registry);
	}
	cloned["model"] = upstreamModel;
	return { body: cloned, registry: registry };
}

/**
 * 还原非流式 Responses 响应里的工具条目。
 * @param registry - 请求的工具登记表
 * @param body - 上游响应体
 * @param options - 还原选项
 * @returns 同一个响应体，条目已就地还原
 */
export function restoreResponsesBody(
	registry: ResponseToolRegistry,
	body: Record<string, unknown>,
	options: RestoreResponsesOptions,
): Record<string, unknown> {
	const output = Array.isArray(body["output"]) ? body["output"] : undefined;
	if (!output) {
		return body;
	}
	for (const item of output) {
		restoreOutputItem(registry, asRecord(item), "done", options);
	}
	return body;
}

/**
 * 还原一条 Responses SSE 事件里的工具条目。
 * @param registry - 请求的工具登记表
 * @param event - 上游事件数据
 * @param options - 还原选项
 * @returns 事件数据；需要改写形状时返回新对象
 */
export function restoreResponsesEvent(
	registry: ResponseToolRegistry,
	event: Record<string, unknown>,
	options: RestoreResponsesOptions,
): Record<string, unknown> {
	const type = textOf(event["type"]);
	if (type === "response.output_item.added" || type === "response.output_item.done") {
		const phase = type === "response.output_item.added" ? "added" : "done";
		restoreOutputItem(registry, asRecord(event["item"]), phase, options);
		return event;
	}
	if (type === "response.function_call_arguments.done") {
		return restoreArgumentsDone(registry, event, options);
	}
	if (type === "response.completed" || type === "response.incomplete") {
		const response = asRecord(event["response"]);
		const output = response && Array.isArray(response["output"]) ? response["output"] : undefined;
		if (output) {
			for (const item of output) {
				restoreOutputItem(registry, asRecord(item), "done", options);
			}
		}
		return event;
	}
	return event;
}

/**
 * 规范化请求体里的工具、历史条目与 tool_choice。
 * @param body - 已克隆的请求体
 * @param registry - 本次请求的登记表
 * @throws ApiError 工具声明、输入条目或 tool_choice 非法时抛出
 */
function normalizeResponseBody(body: Record<string, unknown>, registry: ResponseToolRegistry): void {
	const rawInput = body["input"];
	if (rawInput !== undefined && rawInput !== null && typeof rawInput !== "string" && !Array.isArray(rawInput)) {
		throw ApiError.badRequest("input 必须是字符串或条目数组");
	}
	const input = Array.isArray(rawInput) ? rawInput : undefined;
	const additionalTools: unknown[] = [];
	const preserved: unknown[] = [];
	let inputTouched = false;
	if (input) {
		for (const item of input) {
			const record = asRecord(item);
			if (!record) {
				throw ApiError.badRequest("input 条目必须是 JSON 对象");
			}
			const type = textOf(record["type"]);
			if (type === "additional_tools") {
				const tools = record["tools"];
				if (!Array.isArray(tools)) {
					throw ApiError.badRequest("additional_tools 条目必须包含 tools 数组");
				}
				additionalTools.push(...tools);
				inputTouched = true;
				continue;
			}
			if (type === "compaction" || type === "reasoning") {
				inputTouched = true;
				continue;
			}
			preserved.push(item);
		}
	}
	const rawTools = body["tools"];
	if (rawTools !== undefined && rawTools !== null && !Array.isArray(rawTools)) {
		throw ApiError.badRequest("tools 必须是工具数组");
	}
	const declared = Array.isArray(rawTools) ? rawTools : [];
	body["tools"] = flattenDeclaredTools([...declared, ...additionalTools], registry);
	if (input) {
		const rewritten = rewriteHistoricalItems(preserved, registry);
		if (inputTouched || rewritten.changed) {
			body["input"] = rewritten.items;
		}
	}
	rewriteToolChoice(body, registry);
}

/**
 * 展开工具声明，并登记命名空间与 custom 工具。
 * @param tools - 工具声明列表
 * @param registry - 本次请求的登记表
 * @returns 上游使用的扁平工具列表
 * @throws ApiError 工具声明非法或展开后名字冲突时抛出
 */
function flattenDeclaredTools(tools: readonly unknown[], registry: ResponseToolRegistry): unknown[] {
	const flattened: unknown[] = [];
	for (const raw of tools) {
		const tool = asRecord(raw);
		if (!tool) {
			throw ApiError.badRequest("工具声明必须是 JSON 对象");
		}
		const type = textOf(tool["type"]);
		if (type === "namespace") {
			const namespace = textOf(tool["name"]);
			const children = Array.isArray(tool["tools"]) ? tool["tools"] : undefined;
			if (!namespace || !children) {
				throw ApiError.badRequest("namespace 工具必须包含 name 与 tools 数组");
			}
			for (const childRaw of children) {
				const child = asRecord(childRaw);
				if (!child) {
					throw ApiError.badRequest("namespace 子工具必须是 JSON 对象");
				}
				const wasCustom = textOf(child["type"]) === "custom";
				if (!keepTool(child)) {
					continue;
				}
				requireFunctionTool(child);
				const childName = textOf(child["name"]) ?? "";
				const qualified = flattenToolName(childName, namespace);
				const identity: ResponseToolIdentity = { name: childName, namespace: namespace, isCustom: wasCustom };
				const previous = registry.identities.get(qualified);
				if (previous) {
					if (
						previous.name !== identity.name ||
						previous.namespace !== identity.namespace ||
						previous.isCustom !== identity.isCustom
					) {
						throw ApiError.badRequest(`命名空间展开后工具名冲突：${qualified}`);
					}
					continue;
				}
				registry.identities.set(qualified, identity);
				flattened.push({ ...child, name: qualified });
			}
			continue;
		}
		if (!keepTool(tool)) {
			continue;
		}
		if (type === "web_search") {
			flattened.push({ type: "web_search" });
			continue;
		}
		const wasCustom = type === "custom";
		const name = textOf(tool["name"]);
		if (wasCustom && name !== undefined && !registry.identities.has(name)) {
			registry.identities.set(name, { name: name, isCustom: true });
		}
		flattened.push(tool);
	}
	return flattened;
}

/**
 * 判断一个工具能否发往 Responses 上游；custom 工具会就地改成 function。
 * @param tool - 工具声明
 * @returns 是否保留；false 表示客户端专用工具需要丢弃
 */
function keepTool(tool: Record<string, unknown>): boolean {
	const type = textOf(tool["type"]);
	const name = textOf(tool["name"]);
	if (type === "custom" && name === "apply_patch") {
		return false;
	}
	if (type === "tool_search" || type === "image_generation") {
		return false;
	}
	if (type === "custom") {
		tool["type"] = "function";
		if (!hasContent(tool["parameters"])) {
			tool["parameters"] = { ...EMPTY_OBJECT_SCHEMA };
		}
	}
	return true;
}

/**
 * 要求工具在展开后是可翻译的 function 工具。
 * @param tool - 命名空间子工具
 * @throws ApiError 工具类型不是 function 时抛出
 */
function requireFunctionTool(tool: Record<string, unknown>): void {
	if (textOf(tool["type"]) !== "function") {
		const type = textOf(tool["type"]) ?? "unknown";
		throw ApiError.badRequest(`不支持的工具类型 ${type}；OpenCode Go 只接受 function 工具`);
	}
}

/**
 * 改写历史调用条目的命名空间、custom 形状与空参数。
 * @param items - 保留下来的输入条目
 * @param registry - 本次请求的登记表
 * @returns 改写后的条目与是否发生变化
 */
function rewriteHistoricalItems(
	items: readonly unknown[],
	registry: ResponseToolRegistry,
): { readonly items: unknown[]; readonly changed: boolean } {
	const rewritten: unknown[] = [];
	let changed = false;
	for (const item of items) {
		const record = asRecord(item);
		if (!record) {
			rewritten.push(item);
			continue;
		}
		const type = textOf(record["type"]);
		if (type === "custom_tool_call") {
			const next: Record<string, unknown> = { ...record, type: "function_call" };
			if (Object.hasOwn(next, "input")) {
				const input = next["input"];
				delete next["input"];
				next["arguments"] = JSON.stringify({ input: input });
			}
			rewritten.push(withHistoricalNamespace(next, registry, false));
			changed = true;
			continue;
		}
		if (type === "custom_tool_call_output") {
			rewritten.push({ ...record, type: "function_call_output" });
			changed = true;
			continue;
		}
		if (type === "function_call") {
			const args = record["arguments"];
			const next =
				typeof args !== "string" || args.trim() === "" || args.trim() === "null"
					? { ...record, arguments: "{}" }
					: record;
			const withNamespace = withHistoricalNamespace(next, registry, false);
			if (withNamespace !== record) {
				changed = true;
			}
			rewritten.push(withNamespace);
			continue;
		}
		rewritten.push(item);
	}
	return { items: rewritten, changed: changed };
}

/**
 * 把历史条目的 `namespace` 合并进工具名。
 * @param item - 历史调用条目
 * @param registry - 本次请求的登记表
 * @param isCustom - 是否来自 custom 工具
 * @returns 同一个对象（无命名空间）或改写后的新对象
 */
function withHistoricalNamespace(
	item: Record<string, unknown>,
	registry: ResponseToolRegistry,
	isCustom: boolean,
): Record<string, unknown> {
	const namespace = textOf(item["namespace"]);
	if (namespace === undefined) {
		return item;
	}
	const name = textOf(item["name"]) ?? "";
	const qualified = flattenToolName(name, namespace);
	if (!registry.identities.has(qualified)) {
		registry.identities.set(qualified, { name: name, namespace: namespace, isCustom: isCustom });
	}
	const next: Record<string, unknown> = { ...item, name: qualified };
	delete next["namespace"];
	return next;
}

/**
 * 把带命名空间的 tool_choice 改写成扁平工具名。
 * @param body - 请求体
 * @param registry - 本次请求的登记表
 */
function rewriteToolChoice(body: Record<string, unknown>, registry: ResponseToolRegistry): void {
	const choice = asRecord(body["tool_choice"]);
	if (!choice) {
		return;
	}
	const namespace = textOf(choice["namespace"]);
	if (namespace === undefined) {
		return;
	}
	const name = textOf(choice["name"]) ?? "";
	const qualified = flattenToolName(name, namespace);
	if (!registry.identities.has(qualified)) {
		registry.identities.set(qualified, { name: name, namespace: namespace, isCustom: false });
	}
	body["tool_choice"] = { type: textOf(choice["type"]) ?? "function", name: qualified };
}

/**
 * 还原一个输出条目的工具标识。
 * @param registry - 请求的工具登记表
 * @param item - 输出条目
 * @param phase - 流式条目阶段
 * @param options - 还原选项
 */
function restoreOutputItem(
	registry: ResponseToolRegistry,
	item: Record<string, unknown> | undefined,
	phase: "added" | "done",
	options: RestoreResponsesOptions,
): void {
	if (!item) {
		return;
	}
	const type = textOf(item["type"]);
	if (type !== "function_call" && type !== "custom_tool_call") {
		return;
	}
	const wireName = textOf(item["name"]);
	if (wireName === undefined) {
		return;
	}
	const identity = registry.identities.get(wireName);
	if (!identity) {
		return;
	}
	if (identity.namespace !== undefined) {
		item["namespace"] = identity.namespace;
	}
	if (identity.name !== wireName) {
		item["name"] = identity.name;
	}
	if (!options.restoreCustom || !identity.isCustom || type !== "function_call") {
		return;
	}
	item["type"] = "custom_tool_call";
	item["input"] = phase === "added" ? "" : unwrapCustomToolInput(item["arguments"]);
	delete item["arguments"];
	const itemId = textOf(item["id"]);
	if (itemId !== undefined) {
		registry.customItems.add(itemId);
	}
	const callId = textOf(item["call_id"]);
	if (callId !== undefined) {
		registry.customItems.add(callId);
	}
}

/**
 * 还原 `response.function_call_arguments.done` 事件。
 * @param registry - 请求的工具登记表
 * @param event - 上游事件数据
 * @param options - 还原选项
 * @returns 原事件或 custom 工具输入事件
 */
function restoreArgumentsDone(
	registry: ResponseToolRegistry,
	event: Record<string, unknown>,
	options: RestoreResponsesOptions,
): Record<string, unknown> {
	const wireName = textOf(event["name"]);
	const identity = wireName === undefined ? undefined : registry.identities.get(wireName);
	if (identity && identity.name !== wireName) {
		event["name"] = identity.name;
	}
	if (!options.restoreCustom) {
		return event;
	}
	const itemId = textOf(event["item_id"]);
	let custom = identity?.isCustom === true;
	if (!custom && itemId !== undefined) {
		custom = registry.customItems.has(itemId);
	}
	if (!custom) {
		return event;
	}
	const next: Record<string, unknown> = {
		type: "response.custom_tool_call_input.done",
		input: unwrapCustomToolInput(event["arguments"]),
	};
	if (event["item_id"] !== undefined) {
		next["item_id"] = event["item_id"];
	}
	if (event["output_index"] !== undefined) {
		next["output_index"] = event["output_index"];
	}
	return next;
}

/**
 * 读取非空字符串。
 * @param value - 待判定值
 * @returns 去空白后的字符串；空值返回 undefined
 */
function textOf(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const text = value.trim();
	return text.length > 0 ? text : undefined;
}

/**
 * 断言对象。
 * @param value - 待判定值
 * @returns 对象记录；不是对象时为 undefined
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/**
 * 深拷贝 JSON 值，避免改写调用方共享的请求体。
 * @param value - 待拷贝值
 * @returns 拷贝后的值
 */
function cloneJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(cloneJsonValue);
	}
	if (value !== null && typeof value === "object") {
		const source = value as Record<string, unknown>;
		const copy: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(source)) {
			copy[key] = cloneJsonValue(item);
		}
		return copy;
	}
	return value;
}

/**
 * 判断字段是否有内容。
 * @param value - 字段值
 * @returns 非空、且不是 JSON `null` 时返回 true
 */
function hasContent(value: unknown): boolean {
	if (value === undefined || value === null) {
		return false;
	}
	if (typeof value === "string") {
		const text = value.trim();
		return text.length > 0 && text !== "null";
	}
	return true;
}

/**
 * 把 custom 工具输入值写成字符串。
 * @param value - custom 工具输入值
 * @returns 字符串值本身，否则为 JSON 文本
 */
function stringifyCustomInput(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	return JSON.stringify(value) ?? "";
}
