/**
 * SpendLog 内容寻址块编解码。
 *
 * 累积式聊天快照把同一段对话重复存很多份：同一个请求里 `messages` 与
 * `proxy_server_request.body.messages` 是同一份内容，上游请求体再存一份；跨轮次又把
 * 整段历史原样重存。这里把「单条消息」按内容寻址存进 `LiteLLM_SpendLogBlocks`，
 * SpendLogs 的 jsonb 里只留 22 字符的引用 id 列表。
 *
 * 两条不变量：
 * 1. **字面量永远合法**。读侧只在值恰好是合法引用包装时才组装，其余原样返回，
 *    因此历史行、`ActiveRequestRecovery` 直接复制的行、手工写入的行都不需要迁移。
 * 2. **块只增不删**。块被多个请求共享，删除会让还引用它的行失去内容。
 *
 * 除了逐条的对话数组，请求体里还有两类「一次生成、逐轮重发」的大字段：
 * `tools`（工具定义，单次 30 KB 量级、跨请求只有一个值）与 `system`（system prompt，
 * Claude Code 每轮都会重发）。它们按**整个数组**一个块存，并在行里留下会话时间线
 * 分类判定需要的投影（元素个数与首个名称/前缀），避免读取路径回头 join 块表。
 *
 * 引用形态（列根没有父对象，因此和 body 内不同）：
 * - `SpendLogs.messages` → `{"_litellm_ref_messages": ["<id>", ...], "_litellm_ref_bytes": 1234}`
 * - `proxy_server_request.body` → 删除 `messages` 键，新增 `_litellm_ref_messages: ["<id>", ...]`
 * - `proxy_server_request.body` → 删除 `input` 键，新增 `_litellm_ref_input: ["<id>", ...]`
 * - `proxy_server_request.upstream_request.body` 同上
 * - `proxy_server_request.body` → 删除 `tools`，新增 `_litellm_ref_tools: "<id>"` +
 *   `_litellm_ref_tools_count: N`（`_litellm_ref_tools_first` 是首个工具名）
 * - `proxy_server_request.body` → 删除 `system`，新增 `_litellm_ref_system: "<id>"` +
 *   `_litellm_ref_system_count: N`（`_litellm_ref_system_first/second` 是前两段前缀）
 * - 引用列表与 `SpendLogs.messages` 列根完全相同时写成字符串 `"$messages"`
 *
 * `LiteLLM_ActiveRequests.proxy_server_request` 复用同一套编码（见
 * {@link encodeActiveRequestPayload}）：在途行在请求生命周期里被 `jsonb ||` 整值重写多次，
 * 正文留在行里会让每次补写都退化成「解压-重建-重压缩」几十 MB 的整列写入。
 */

import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { liteLLM_SpendLogBlocks } from "../db/schema/spendLogBlocks";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import { getConfig } from "../core/config";
import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("Spend:SpendLogBlocks");

/** 列根引用键：`SpendLogs.messages` 整体被替换成含该键的对象。 */
export const SPEND_LOG_MESSAGE_REF_KEY = "_litellm_ref_messages";
/** body 内的 `input` 引用键（Responses / CLIProxy 协议）。 */
export const SPEND_LOG_INPUT_REF_KEY = "_litellm_ref_input";
/** 列根包装里记录逻辑字节数，供会话时间线计算页面体积预算。 */
export const SPEND_LOG_REF_BYTES_KEY = "_litellm_ref_bytes";
/** 组装时找不到块内容的占位键，保证页面不会因为缺块整页失败。 */
export const SPEND_LOG_REF_MISSING_KEY = "_litellm_ref_missing";
/** body 内的 `tools` 引用键：整个工具定义数组只存一个块。 */
export const SPEND_LOG_TOOLS_REF_KEY = "_litellm_ref_tools";
/** `tools` 的元素个数，供会话时间线判定内部调用时使用。 */
export const SPEND_LOG_TOOLS_COUNT_KEY = "_litellm_ref_tools_count";
/** 首个工具名，供会话时间线判定内部调用时使用。 */
export const SPEND_LOG_TOOLS_FIRST_KEY = "_litellm_ref_tools_first";
/** body 内的 `system` 引用键：整个 system 块数组只存一个块。 */
export const SPEND_LOG_SYSTEM_REF_KEY = "_litellm_ref_system";
/** `system` 的块数。 */
export const SPEND_LOG_SYSTEM_COUNT_KEY = "_litellm_ref_system_count";
/** 第一段 system 前缀，长度与时间线 SQL 的 `LEFT(...,256)` 一致。 */
export const SPEND_LOG_SYSTEM_FIRST_KEY = "_litellm_ref_system_first";
/** 第二段 system 前缀。 */
export const SPEND_LOG_SYSTEM_SECOND_KEY = "_litellm_ref_system_second";
/** 引用列表与同行的 `SpendLogs.messages` 列根完全相同时用它代替整个 id 数组。 */
export const SPEND_LOG_SAME_AS_MESSAGES = "$messages";

/** 与时间线 SQL 的 `LEFT(...,256)` 对齐的分类前缀长度。 */
const SYSTEM_PROMPT_PREFIX_LENGTH = 256;

/** 128 位 base64url 摘要定长 22 字符；形态不合法的值一律按字面量处理。 */
const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
/** 单次 IN 查询的 id 上限，避免超过 PostgreSQL 绑定参数上限。 */
const BLOCK_LOOKUP_CHUNK_SIZE = 5_000;
/** 单次 INSERT 的块数量上限（每块 3 个绑定参数），避免超长会话顶到参数上限。 */
export const SPEND_LOG_BLOCK_INSERT_CHUNK_SIZE = 1_000;
/** 内容摘要取 SHA-256 的前 128 位：1e8 个块的碰撞概率仍在 1e-23 量级。 */
const BLOCK_ID_DIGEST_BYTES = 16;
/**
 * 少于 4 条消息的数组保持内联。
 *
 * 这类数组都是单轮请求，几乎没有跨请求复用，引用只省下同请求内的一份副本；
 * 而会话时间线要在 SQL 里读 `messages[0..1]` 判断 Claude Code 内部调用，
 * 保留内联数组可以让这条判定完全不用改，也不必把前两条消息额外内联一份。
 */
const MIN_REFERENCED_MESSAGE_COUNT = 4;

/**
 * 在途行用的短数组阈值：只要有一条消息就引用。
 *
 * 在途行不走会话时间线的 SQL 分类（时间线只读最终 SpendLogs），因此没有「保留前两条
 * 消息内联」的约束；而它每轮都会被 `jsonb ||` 整值重写，正文越窄收益越大。
 */
export const ACTIVE_REQUEST_MIN_REFERENCED_MESSAGE_COUNT = 1;

/** 一条待写入的块记录。 */
export interface SpendLogBlockRecord {
	/**
	 *
	 */
	readonly blockId: string;
	/**
	 *
	 */
	readonly payload: unknown;
	/**
	 *
	 */
	readonly byteSize: number;
}

/** 一次编码的结果：改写后的列值 + 需要写入的块。 */
export interface SpendLogBlockEncoding {
	/**
	 *
	 */
	readonly messages: unknown;
	/**
	 *
	 */
	readonly proxyServerRequest: unknown;
	/**
	 *
	 */
	readonly blocks: readonly SpendLogBlockRecord[];
}

/** 块内容查询：缺块时返回 undefined，由调用方放占位对象。 */
export type SpendLogBlockLookup = (blockId: string) => unknown;

/**
 * 仅接受非 null 的普通对象。
 * @param value - 待判断的值
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 与 PostgreSQL `jsonb` 一致的键比较：先比 UTF-8 字节长度，再逐字节比较。
 *
 * jsonb 输出时按这个顺序重排对象键。这里对齐同一规则，使「同一语义、不同键序」
 * 的请求体收敛到同一个块；同时让 id 在离线工具里可以从库内文本重算校验。
 * @param left - 左键
 * @param right - 右键
 */
function compareJsonKeys(left: string, right: string): number {
	const leftBytes = Buffer.from(left, "utf8");
	const rightBytes = Buffer.from(right, "utf8");
	if (leftBytes.length !== rightBytes.length) {
		return leftBytes.length - rightBytes.length;
	}
	return Buffer.compare(leftBytes, rightBytes);
}

/**
 * 规范化 JSON 文本：对象按键排序、数组保序、其余标量沿用 `JSON.stringify` 语义。
 * @param value - 待序列化的 JSON 值
 */
export function canonicalJson(value: unknown): string {
	if (value === undefined || typeof value === "function" || typeof value === "symbol") {
		return "null";
	}
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value) as string;
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		// Date / Buffer 等带 toJSON 的值沿用 JSON.stringify，避免改变它们原有的表示。
		return JSON.stringify(value) ?? "null";
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record)
		.filter((key) => record[key] !== undefined)
		.sort(compareJsonKeys);
	const fields = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
	return `{${fields.join(",")}}`;
}

/**
 * 由规范化 JSON 派生块 id（SHA-256 前 128 位，base64url）。
 * @param canonical - 规范化后的 JSON 文本
 */
function blockIdFromCanonical(canonical: string): string {
	return createHash("sha256")
		.update(canonical, "utf8")
		.digest()
		.subarray(0, BLOCK_ID_DIGEST_BYTES)
		.toString("base64url");
}

/**
 * 计算任意 JSON 值的块 id。
 * @param value - 任意 JSON 值
 */
export function spendLogBlockId(value: unknown): string {
	return blockIdFromCanonical(canonicalJson(value));
}

/**
 * 读取引用 id 列表：必须是全部由合法 id 组成的字符串数组，否则返回 null。
 * @param value - 待判断的值
 */
function readRefIdList(value: unknown): string[] | null {
	if (!Array.isArray(value)) {
		return null;
	}
	for (const item of value) {
		if (typeof item !== "string" || !BLOCK_ID_PATTERN.test(item)) {
			return null;
		}
	}
	return value as string[];
}

/**
 * 读取 `SpendLogs.messages` 列根的引用包装。
 * @param value - 列值
 */
function readMessagesColumnRefs(value: unknown): string[] | null {
	if (!isRecord(value)) {
		return null;
	}
	return readRefIdList(value[SPEND_LOG_MESSAGE_REF_KEY]);
}

/**
 * 判断一个值是不是「缺块」占位对象：只有 `_litellm_ref_missing` 一个键且值是字符串。
 * @param value - 待判断的值
 */
export function isMissingSpendLogBlockRef(value: unknown): boolean {
	if (!isRecord(value)) {
		return false;
	}
	const keys = Object.keys(value);
	return keys.length === 1 && keys[0] === SPEND_LOG_REF_MISSING_KEY && typeof value[SPEND_LOG_REF_MISSING_KEY] === "string";
}

/**
 * 编码过程收集块；同一个请求内重复内容只保留一条块记录。
 */
class SpendLogBlockCollector {
	private readonly _blocks = new Map<string, SpendLogBlockRecord>();

	/**
	 * @param value - 单条消息的 JSON 值
	 */
	add(value: unknown): SpendLogBlockRecord {
		const canonical = canonicalJson(value);
		const blockId = blockIdFromCanonical(canonical);
		const existing = this._blocks.get(blockId);
		if (existing !== undefined) {
			return existing;
		}
		const record: SpendLogBlockRecord = {
			blockId: blockId,
			payload: value,
			byteSize: Buffer.byteLength(canonical, "utf8"),
		};
		this._blocks.set(blockId, record);
		return record;
	}

	/**
	 * @returns 本次请求需要写入的块（已按 id 去重）
	 */
	list(): readonly SpendLogBlockRecord[] {
		return [...this._blocks.values()];
	}
}

/**
 * 把一个消息数组改写成引用 id 列表；短数组保持内联。
 * @param messages - 消息数组
 * @param collector - 块收集器
 * @param minMessageCount - 触发引用的最少消息条数
 * @returns 需要引用时返回 id 列表与逻辑字节数，否则返回 null
 */
function encodeMessageArray(
	messages: readonly unknown[],
	collector: SpendLogBlockCollector,
	minMessageCount: number = MIN_REFERENCED_MESSAGE_COUNT,
): { ids: string[]; bytes: number } | null {
	if (messages.length < minMessageCount) {
		return null;
	}
	const ids: string[] = [];
	let bytes = 0;
	for (const message of messages) {
		const record = collector.add(message);
		ids.push(record.blockId);
		bytes += record.byteSize;
	}
	return { ids: ids, bytes: bytes };
}

/**
 * 剥离客户端自带的引用键。
 *
 * 引用键只允许由本模块写入：如果请求体里本来就有同名键，读侧会把它当成引用，
 * 因此写入前必须剥掉，宁可丢掉这个未知字段也不能让客户端构造出引用。
 * @param value - 待清洗的对象
 */
function stripRefKeys(value: Record<string, unknown>): Record<string, unknown> {
	const stripped: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (SPEND_LOG_REF_KEYS.has(key)) {
			continue;
		}
		stripped[key] = entry;
	}
	return stripped;
}

/**
 * 全部由本模块拥有的引用键：客户端自带的同名键一律剥离，避免伪造引用。
 */
const SPEND_LOG_REF_KEYS: ReadonlySet<string> = new Set([
	SPEND_LOG_MESSAGE_REF_KEY,
	SPEND_LOG_INPUT_REF_KEY,
	SPEND_LOG_REF_BYTES_KEY,
	SPEND_LOG_REF_MISSING_KEY,
	SPEND_LOG_TOOLS_REF_KEY,
	SPEND_LOG_TOOLS_COUNT_KEY,
	SPEND_LOG_TOOLS_FIRST_KEY,
	SPEND_LOG_SYSTEM_REF_KEY,
	SPEND_LOG_SYSTEM_COUNT_KEY,
	SPEND_LOG_SYSTEM_FIRST_KEY,
	SPEND_LOG_SYSTEM_SECOND_KEY,
]);

/**
 * 取 system 块的文本前缀：字符串块直接取，`{type,text}` 块取 `text`。
 *
 * 与 PostgreSQL `LEFT(...,256)` 一致按字符（码点）截断，避免代理对在边界被切开。
 * @param block - system 数组里的单块
 */
function systemPromptPrefix(block: unknown): string | null {
	const text =
		typeof block === "string" ? block : isRecord(block) && typeof block["text"] === "string" ? block["text"] : null;
	if (text === null) {
		return null;
	}
	return Array.from(text).slice(0, SYSTEM_PROMPT_PREFIX_LENGTH).join("");
}

/**
 * 判断两个 id 列表是否完全相同（用于「与 messages 列同一份内容」的合并）。
 * @param left - 左列表
 * @param right - 右列表
 */
function sameIdList(left: readonly string[], right: readonly string[] | null): boolean {
	if (right === null || left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}

/**
 * 把整个数组作为一个块引用：`tools` / `system` 这类整体复用的字段用它。
 * @param values - 数组值
 * @param collector - 块收集器
 */
function encodeWholeArray(values: readonly unknown[], collector: SpendLogBlockCollector): string {
	return collector.add(values).blockId;
}

/**
 * 编码 `SpendLogs.messages` 列值。
 * @param messages - 原始列值（通常是消息数组，也可能是 `{}` 或历史对象）
 * @param collector - 块收集器
 */
function encodeMessagesColumn(messages: unknown, collector: SpendLogBlockCollector): unknown {
	if (Array.isArray(messages)) {
		const encoded = encodeMessageArray(messages, collector);
		return encoded === null ? messages : { [SPEND_LOG_MESSAGE_REF_KEY]: encoded.ids, [SPEND_LOG_REF_BYTES_KEY]: encoded.bytes };
	}
	if (isRecord(messages)) {
		// `{}` 表示「未存储」；带上客户端自造引用键的对象也走这里，剥完仍是普通对象。
		return stripRefKeys(messages);
	}
	return messages;
}

/**
 * 编码一个请求体：把 `messages` / `input` 数组换成引用列表，`tools` / `system` 换成整块引用。
 * @param body - 请求体
 * @param collector - 块收集器
 * @param columnIds - 同一行 `SpendLogs.messages` 列根的引用列表（可能为 null）
 * @param minMessageCount - 触发引用的最少消息条数
 */
function encodeRequestBody(
	body: unknown,
	collector: SpendLogBlockCollector,
	columnIds: readonly string[] | null,
	minMessageCount: number = MIN_REFERENCED_MESSAGE_COUNT,
): unknown {
	if (!isRecord(body)) {
		return body;
	}
	const encoded: Record<string, unknown> = stripRefKeys(body);
	for (const [sourceKey, refKey] of [
		["messages", SPEND_LOG_MESSAGE_REF_KEY],
		["input", SPEND_LOG_INPUT_REF_KEY],
	] as const) {
		const value = encoded[sourceKey];
		if (!Array.isArray(value)) {
			continue;
		}
		const encodedArray = encodeMessageArray(value, collector, minMessageCount);
		if (encodedArray === null) {
			continue;
		}
		delete encoded[sourceKey];
		encoded[refKey] = sameIdList(encodedArray.ids, columnIds) ? SPEND_LOG_SAME_AS_MESSAGES : encodedArray.ids;
	}
	const tools = encoded["tools"];
	if (Array.isArray(tools) && tools.length > 0) {
		delete encoded["tools"];
		encoded[SPEND_LOG_TOOLS_REF_KEY] = encodeWholeArray(tools, collector);
		encoded[SPEND_LOG_TOOLS_COUNT_KEY] = tools.length;
		const firstTool = tools[0];
		if (isRecord(firstTool) && typeof firstTool["name"] === "string") {
			encoded[SPEND_LOG_TOOLS_FIRST_KEY] = firstTool["name"];
		}
	}
	const system = encoded["system"];
	if (Array.isArray(system) && system.length > 0) {
		delete encoded["system"];
		encoded[SPEND_LOG_SYSTEM_REF_KEY] = encodeWholeArray(system, collector);
		encoded[SPEND_LOG_SYSTEM_COUNT_KEY] = system.length;
		const firstPrompt = systemPromptPrefix(system[0]);
		if (firstPrompt !== null) {
			encoded[SPEND_LOG_SYSTEM_FIRST_KEY] = firstPrompt;
		}
		const secondPrompt = system.length > 1 ? systemPromptPrefix(system[1]) : null;
		if (secondPrompt !== null) {
			encoded[SPEND_LOG_SYSTEM_SECOND_KEY] = secondPrompt;
		}
	}
	return encoded;
}

/**
 * 编码 `proxy_server_request`：下游 body 与上游请求体里的对话数组分别换成引用。
 * @param proxyServerRequest - 原始值
 * @param collector - 块收集器
 * @param columnIds - 同一行 `SpendLogs.messages` 列根的引用列表（可能为 null）
 * @param minMessageCount - 触发引用的最少消息条数
 */
function encodeProxyServerRequest(
	proxyServerRequest: unknown,
	collector: SpendLogBlockCollector,
	columnIds: readonly string[] | null,
	minMessageCount: number = MIN_REFERENCED_MESSAGE_COUNT,
): unknown {
	if (!isRecord(proxyServerRequest)) {
		return proxyServerRequest;
	}
	const encoded: Record<string, unknown> = { ...proxyServerRequest };
	if ("body" in encoded) {
		encoded["body"] = encodeRequestBody(encoded["body"], collector, columnIds, minMessageCount);
	}
	const upstreamRequest = encoded["upstream_request"];
	if (isRecord(upstreamRequest) && "body" in upstreamRequest) {
		encoded["upstream_request"] = {
			...upstreamRequest,
			body: encodeRequestBody(upstreamRequest["body"], collector, columnIds, minMessageCount),
		};
	}
	return encoded;
}

/**
 * 编码一条 SpendLog：返回改写后的列值与需要落库的块。
 *
 * 非数组值（图像 prompt 的裸字符串、历史对象、`{}`）保持内联，读取成本可忽略。
 * @param input - 原始 `messages` 列值与 `proxy_server_request`
 * @param options - `minMessageCount`：触发引用的最少消息条数，默认 4
 */
export function collectSpendLogBlocks(
	input: {
		readonly messages: unknown;
		readonly proxyServerRequest: unknown;
	},
	options: { readonly minMessageCount?: number } = {},
): SpendLogBlockEncoding {
	const collector = new SpendLogBlockCollector();
	const messages = encodeMessagesColumn(input.messages, collector);
	const proxyServerRequest = encodeProxyServerRequest(
		input.proxyServerRequest,
		collector,
		readMessagesColumnRefs(messages),
		options.minMessageCount ?? MIN_REFERENCED_MESSAGE_COUNT,
	);
	return { messages: messages, proxyServerRequest: proxyServerRequest, blocks: collector.list() };
}

/**
 * 在途行正文引用化的体量预算。
 *
 * 引用化把「一次整列写入」拆成「多条块行 + 一次引用写入」，同样字数下写出量级相当、
 * 但多出分块与 id 生成的开销。超过这个预算的请求体属于极端输入（线上 p95 约 20 MB，
 * 最大观察值 45 MB），在请求路径上回退为内联更稳妥；回退后行会变宽，但不会把一次
 * 上游调用前的写入拖成几秒。
 */
export const ACTIVE_REQUEST_BLOCK_BUDGET_BYTES = 64 * 1024 * 1024;

/**
 * 统计一批块的内容字节数，用于引用化前的体量预算判断。
 * @param blocks - 块列表
 */
export function spendLogBlockBytes(blocks: readonly SpendLogBlockRecord[]): number {
	let total = 0;
	for (const block of blocks) {
		total += block.byteSize;
	}
	return total;
}

/**
 * 编码在途行的 `proxy_server_request`：只处理该列，短数组也引用。
 * @param proxyServerRequest - 原始 `proxy_server_request`
 */
export function encodeActiveRequestPayload(proxyServerRequest: unknown): {
	readonly proxyServerRequest: unknown;
	readonly blocks: readonly SpendLogBlockRecord[];
} {
	const encoding = collectSpendLogBlocks(
		{ messages: {}, proxyServerRequest: proxyServerRequest },
		{ minMessageCount: ACTIVE_REQUEST_MIN_REFERENCED_MESSAGE_COUNT },
	);
	return { proxyServerRequest: encoding.proxyServerRequest, blocks: encoding.blocks };
}

/**
 * 收集一行里所有被引用的块 id（去重）。
 * @param messages - `SpendLogs.messages` 列值
 * @param proxyServerRequest - `proxy_server_request` 列值
 */
export function collectReferencedBlockIds(messages: unknown, proxyServerRequest: unknown): string[] {
	const ids = new Set<string>();
	for (const id of readMessagesColumnRefs(messages) ?? []) {
		ids.add(id);
	}
	if (isRecord(proxyServerRequest)) {
		for (const container of [proxyServerRequest["body"], (proxyServerRequest["upstream_request"] as Record<string, unknown> | undefined)?.["body"]]) {
			if (!isRecord(container)) {
				continue;
			}
			for (const key of [SPEND_LOG_MESSAGE_REF_KEY, SPEND_LOG_INPUT_REF_KEY]) {
				for (const id of readRefIdList(container[key]) ?? []) {
					ids.add(id);
				}
			}
			for (const key of [SPEND_LOG_TOOLS_REF_KEY, SPEND_LOG_SYSTEM_REF_KEY]) {
				const blockId = container[key];
				if (typeof blockId === "string" && BLOCK_ID_PATTERN.test(blockId)) {
					ids.add(blockId);
				}
			}
		}
	}
	return [...ids];
}

/**
 * 把引用 id 列表还原成数组；缺块时保留占位对象，页面可以提示「内容缺失」。
 * @param ids - 引用 id 列表
 * @param lookup - 块内容查询
 * @param missingIds - 收集缺块 id
 */
function resolveRefIdList(
	ids: readonly string[],
	lookup: SpendLogBlockLookup,
	missingIds: string[],
): unknown[] {
	return ids.map((blockId) => {
		const payload = lookup(blockId);
		if (payload === undefined || payload === null) {
			missingIds.push(blockId);
			return { [SPEND_LOG_REF_MISSING_KEY]: blockId };
		}
		return payload;
	});
}

/**
 * 还原整数组引用（`tools` / `system`）：缺块时放占位对象，不抛错。
 * @param blockId - 引用 id
 * @param lookup - 块内容查询
 * @param missingIds - 收集缺块 id
 */
function resolveWholeArrayRef(blockId: string, lookup: SpendLogBlockLookup, missingIds: string[]): unknown {
	const payload = lookup(blockId);
	if (payload === undefined || payload === null) {
		missingIds.push(blockId);
		return { [SPEND_LOG_REF_MISSING_KEY]: blockId };
	}
	return payload;
}

/**
 * 还原 body：把引用键换回 `messages` / `input` / `tools` / `system`。
 *
 * 分类投影键（`_litellm_ref_tools_count` 等）不回填到 body：它们只是时间线的读取
 * 加速，原始请求体里并没有这些字段。
 * @param body - 已编码的 body
 * @param lookup - 块内容查询
 * @param missingIds - 收集缺块 id
 * @param columnIds - 同一行 `SpendLogs.messages` 列根的引用列表（`"$messages"` 标记用）
 */
function restoreRequestBody(
	body: unknown,
	lookup: SpendLogBlockLookup,
	missingIds: string[],
	columnIds: readonly string[] | null,
): unknown {
	if (!isRecord(body)) {
		return body;
	}
	const restored: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(body)) {
		if (
			key === SPEND_LOG_REF_BYTES_KEY ||
			key === SPEND_LOG_TOOLS_COUNT_KEY ||
			key === SPEND_LOG_TOOLS_FIRST_KEY ||
			key === SPEND_LOG_SYSTEM_COUNT_KEY ||
			key === SPEND_LOG_SYSTEM_FIRST_KEY ||
			key === SPEND_LOG_SYSTEM_SECOND_KEY
		) {
			continue;
		}
		if (key === SPEND_LOG_MESSAGE_REF_KEY || key === SPEND_LOG_INPUT_REF_KEY) {
			const ids = value === SPEND_LOG_SAME_AS_MESSAGES ? columnIds : readRefIdList(value);
			const targetKey = key === SPEND_LOG_MESSAGE_REF_KEY ? "messages" : "input";
			if (ids === null) {
				restored[targetKey] = value;
				continue;
			}
			restored[targetKey] = resolveRefIdList(ids, lookup, missingIds);
			continue;
		}
		if (key === SPEND_LOG_TOOLS_REF_KEY || key === SPEND_LOG_SYSTEM_REF_KEY) {
			const targetKey = key === SPEND_LOG_TOOLS_REF_KEY ? "tools" : "system";
			if (typeof value !== "string" || !BLOCK_ID_PATTERN.test(value)) {
				restored[targetKey] = value;
				continue;
			}
			restored[targetKey] = resolveWholeArrayRef(value, lookup, missingIds);
			continue;
		}
		restored[key] = value;
	}
	return restored;
}

/**
 * 还原一行 SpendLog 的 `messages` 与 `proxy_server_request`。
 *
 * 不是引用包装的值原样返回，因此历史行与关闭去重后写入的行都不受影响。
 * @param row - 列值
 * @param lookup - 块内容查询
 */
export function restoreSpendLogPayload(
	row: { readonly messages?: unknown; readonly proxy_server_request?: unknown },
	lookup: SpendLogBlockLookup,
): { messages: unknown; proxyServerRequest: unknown; missingBlockIds: string[] } {
	const missingBlockIds: string[] = [];
	const columnRefs = readMessagesColumnRefs(row.messages);
	const messages = columnRefs === null ? row.messages : resolveRefIdList(columnRefs, lookup, missingBlockIds);

	let proxyServerRequest = row.proxy_server_request;
	if (isRecord(proxyServerRequest)) {
		const restored: Record<string, unknown> = { ...proxyServerRequest };
		if ("body" in restored) {
			restored["body"] = restoreRequestBody(restored["body"], lookup, missingBlockIds, columnRefs);
		}
		const upstreamRequest = restored["upstream_request"];
		if (isRecord(upstreamRequest) && "body" in upstreamRequest) {
			restored["upstream_request"] = {
				...upstreamRequest,
				body: restoreRequestBody(upstreamRequest["body"], lookup, missingBlockIds, columnRefs),
			};
		}
		proxyServerRequest = restored;
	}
	return { messages: messages, proxyServerRequest: proxyServerRequest, missingBlockIds: missingBlockIds };
}

/** 块载荷缓存默认字节上限：32 MiB，约 1.5 万条 2 KB 消息（按 JSON 文本字节计）。 */
const DEFAULT_BLOCK_CACHE_BYTES = 32 * 1024 * 1024;
/** 写前判存保留的已知 id 上限；只存 id，不存载荷。 */
const MAX_KNOWN_BLOCK_IDS = 100_000;

/** 缓存中的一条块。 */
export interface CachedSpendLogBlock {
	/**
	 * 块内容。
	 */
	readonly payload: unknown;
	/**
	 * 规范化 JSON 的字节数。
	 */
	readonly byteSize: number;
}

/**
 * 进程内块缓存：载荷 LRU + 已知 id 集合。
 *
 * 块表只增不删、id 由内容决定，因此同一 id 的载荷永远不变：缓存不需要 TTL，也不需要
 * 跨副本失效。淘汰只影响收益，不影响正确性——id 被淘汰后最多再向数据库确认一次。
 */
export class SpendLogBlockCache {
	private readonly _payloads = new Map<string, CachedSpendLogBlock>();

	private readonly _known = new Map<string, true>();

	private readonly _limitBytes: number;

	private _bytes = 0;

	/**
	 * @param limitBytes - 载荷缓存字节上限；0 表示只记录已知 id，不保留载荷
	 */
	constructor(limitBytes: number) {
		this._limitBytes = limitBytes;
	}

	/**
	 * 该 id 是否已被确认存在（本进程写入过或读到过）。
	 * @param blockId - 块 id
	 */
	isKnown(blockId: string): boolean {
		return this._known.has(blockId);
	}

	/**
	 * 读取载荷并刷新 LRU 位置。
	 * @param blockId - 块 id
	 */
	read(blockId: string): CachedSpendLogBlock | undefined {
		const entry = this._payloads.get(blockId);
		if (entry === undefined) {
			return undefined;
		}
		this._payloads.delete(blockId);
		this._payloads.set(blockId, entry);
		return entry;
	}

	/**
	 * 记录一个已确认存在的块。
	 * @param blockId - 块 id
	 * @param payload - 块内容
	 * @param byteSize - 规范化 JSON 字节数
	 */
	remember(blockId: string, payload: unknown, byteSize: number): void {
		this.markKnown(blockId);
		if (this._limitBytes <= 0) {
			return;
		}
		const existing = this._payloads.get(blockId);
		if (existing !== undefined) {
			this._payloads.delete(blockId);
			this._payloads.set(blockId, existing);
			return;
		}
		const size = Math.max(byteSize, 1);
		this._payloads.set(blockId, { payload: payload, byteSize: size });
		this._bytes += size;
		this._evict();
	}

	/**
	 * 只记录 id：读侧已确认存在但载荷已被淘汰时使用。
	 * @param blockId - 块 id
	 */
	markKnown(blockId: string): void {
		if (this._known.has(blockId)) {
			return;
		}
		this._known.set(blockId, true);
		if (this._known.size <= MAX_KNOWN_BLOCK_IDS) {
			return;
		}
		const oldest = this._known.keys().next().value;
		if (oldest !== undefined) {
			this._known.delete(oldest);
		}
	}

	/**
	 * @returns 当前字节数、载荷条目数与已知 id 数，供诊断与测试使用
	 */
	stats(): { bytes: number; entries: number; known: number } {
		return { bytes: this._bytes, entries: this._payloads.size, known: this._known.size };
	}

	/** 清空缓存（测试用）。 */
	clear(): void {
		this._payloads.clear();
		this._known.clear();
		this._bytes = 0;
	}

	/** 按字节上限淘汰最久未使用的载荷。 */
	private _evict(): void {
		while (this._bytes > this._limitBytes) {
			const oldest = this._payloads.keys().next().value;
			if (oldest === undefined) {
				return;
			}
			const entry = this._payloads.get(oldest);
			this._payloads.delete(oldest);
			if (entry !== undefined) {
				this._bytes -= entry.byteSize;
			}
		}
	}
}

/**
 * 解析缓存字节上限：`LITELLM_SPEND_LOG_BLOCK_CACHE_BYTES`，0 关闭载荷缓存。
 */
function resolveBlockCacheLimit(): number {
	const raw = process.env.LITELLM_SPEND_LOG_BLOCK_CACHE_BYTES;
	if (raw === undefined || raw.trim() === "") {
		return DEFAULT_BLOCK_CACHE_BYTES;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_BLOCK_CACHE_BYTES;
}

/** 进程内块缓存单例。 */
const spendLogBlockCache = new SpendLogBlockCache(resolveBlockCacheLimit());

/** 清空进程内块缓存（测试用）。 */
export function clearSpendLogBlockCacheForTests(): void {
	spendLogBlockCache.clear();
}

/** 只读块表所需的最小数据库能力：普通连接与回收事务句柄都满足。 */
type SpendLogBlockReadDb = Pick<NodePgDatabase<typeof schema>, "select">;

/**
 * 批量读取块内容；已缓存的 id 不再访问数据库。
 * @param db - 数据库实例
 * @param ids - 引用 id 列表
 */
async function loadSpendLogBlocks(
	db: NodePgDatabase<typeof schema>,
	ids: readonly string[],
): Promise<Map<string, unknown>> {
	const uniqueIds = [...new Set(ids)];
	const payloads = new Map<string, unknown>();
	const pending: string[] = [];
	for (const blockId of uniqueIds) {
		const cached = spendLogBlockCache.read(blockId);
		if (cached === undefined) {
			pending.push(blockId);
			continue;
		}
		payloads.set(blockId, cached.payload);
	}
	for (let offset = 0; offset < pending.length; offset += BLOCK_LOOKUP_CHUNK_SIZE) {
		const chunk = pending.slice(offset, offset + BLOCK_LOOKUP_CHUNK_SIZE);
		const rows = await db
			.select({
				blockId: liteLLM_SpendLogBlocks.blockId,
				payload: liteLLM_SpendLogBlocks.payload,
				byteSize: liteLLM_SpendLogBlocks.byteSize,
			})
			.from(liteLLM_SpendLogBlocks)
			.where(inArray(liteLLM_SpendLogBlocks.blockId, chunk));
		for (const row of rows) {
			payloads.set(row.blockId, row.payload);
			spendLogBlockCache.remember(row.blockId, row.payload, row.byteSize);
		}
	}
	return payloads;
}

/**
 * 查询哪些 id 已经存在于块表。
 * @param db - 数据库实例
 * @param ids - 待查询的块 id
 */
async function loadExistingBlockIds(db: SpendLogBlockReadDb, ids: readonly string[]): Promise<Set<string>> {
	const existing = new Set<string>();
	for (let offset = 0; offset < ids.length; offset += BLOCK_LOOKUP_CHUNK_SIZE) {
		const chunk = ids.slice(offset, offset + BLOCK_LOOKUP_CHUNK_SIZE);
		const rows = await db
			.select({ blockId: liteLLM_SpendLogBlocks.blockId })
			.from(liteLLM_SpendLogBlocks)
			.where(inArray(liteLLM_SpendLogBlocks.blockId, chunk));
		for (const row of rows) {
			existing.add(row.blockId);
		}
	}
	return existing;
}

/**
 * 写前判存：过滤掉已经存在的块，只返回需要新写入的部分。
 *
 * 块由内容寻址，跨轮次重发同一段对话时绝大多数块早已存在；盲插仍需把完整载荷送进
 * 数据库（TOAST + 索引探测）再按冲突丢弃。先按进程缓存过滤，未命中的 id 用一次
 * `IN` 查询确认（只传 id）。查询失败时回退为原样返回，让记账路径按旧行为盲插。
 * @param db - 数据库实例或事务句柄
 * @param blocks - 本次需要写入的块
 */
export async function selectMissingSpendLogBlocks(
	db: SpendLogBlockReadDb,
	blocks: readonly SpendLogBlockRecord[],
): Promise<readonly SpendLogBlockRecord[]> {
	if (blocks.length === 0) {
		return [];
	}
	const pending = blocks.filter((block) => !spendLogBlockCache.isKnown(block.blockId));
	if (pending.length === 0) {
		return [];
	}
	let existing: Set<string>;
	try {
		existing = await loadExistingBlockIds(
			db,
			pending.map((block) => block.blockId),
		);
	} catch (error) {
		logger.warn("块存在性预检失败，回退为盲插", { error: error, blocks: pending.length });
		return pending;
	}
	const missing: SpendLogBlockRecord[] = [];
	for (const block of pending) {
		if (existing.has(block.blockId)) {
			spendLogBlockCache.markKnown(block.blockId);
			continue;
		}
		missing.push(block);
	}
	return missing;
}

/**
 * 把刚写入成功的块记入缓存，供后续请求复用于读路径与写前判存。
 * @param blocks - 已提交的块
 */
export function rememberSpendLogBlocks(blocks: readonly SpendLogBlockRecord[]): void {
	for (const block of blocks) {
		spendLogBlockCache.remember(block.blockId, block.payload, block.byteSize);
	}
}

/** 写块所需的最小数据库能力：普通连接与事务句柄都满足。 */
type SpendLogBlockWriteDb = Pick<NodePgDatabase<typeof schema>, "insert">;

/**
 * 分批写入块。
 *
 * 分批是为了避免超长会话把绑定参数数量顶到 PostgreSQL 上限；块由内容寻址，
 * 并发重复写入按冲突丢弃即可。
 * @param db - 数据库实例或事务句柄
 * @param blocks - 需要写入的块（应为判存确认缺失的部分）
 */
export async function writeSpendLogBlocks(db: SpendLogBlockWriteDb, blocks: readonly SpendLogBlockRecord[]): Promise<void> {
	for (let offset = 0; offset < blocks.length; offset += SPEND_LOG_BLOCK_INSERT_CHUNK_SIZE) {
		await db
			.insert(liteLLM_SpendLogBlocks)
			.values(blocks.slice(offset, offset + SPEND_LOG_BLOCK_INSERT_CHUNK_SIZE).map((block) => ({ ...block })))
			.onConflictDoNothing();
	}
}

/**
 * 组装一批 SpendLog 行。
 *
 * 引用 id 跨行合并成一次查询；缺块用占位对象补齐并记录告警，避免整页失败。
 * @template T - 行类型
 * @param db - 数据库实例
 * @param rows - 需要组装的列值
 */
export async function hydrateSpendLogRows<T extends { readonly messages?: unknown; readonly proxy_server_request?: unknown }>(
	db: NodePgDatabase<typeof schema>,
	rows: readonly T[],
): Promise<T[]> {
	const idsByRow = rows.map((row) => collectReferencedBlockIds(row.messages, row.proxy_server_request));
	const allIds = idsByRow.flat();
	if (allIds.length === 0) {
		return [...rows];
	}
	const payloads = await loadSpendLogBlocks(db, allIds);
	const lookup: SpendLogBlockLookup = (blockId) => payloads.get(blockId);
	const missingIds: string[] = [];
	const hydrated = rows.map((row, index) => {
		if (idsByRow[index]!.length === 0) {
			return row;
		}
		const { messages, proxyServerRequest, missingBlockIds } = restoreSpendLogPayload(row, lookup);
		missingIds.push(...missingBlockIds);
		return { ...row, messages: messages, proxy_server_request: proxyServerRequest };
	});
	if (missingIds.length > 0) {
		logger.warn("SpendLog 引用块缺失，已用占位对象补齐", {
			missing: missingIds.length,
			sampleBlockIds: [...new Set(missingIds)].slice(0, 5),
		});
	}
	return hydrated;
}

/**
 * 组装单行 SpendLog（详情与日志流共用）。
 * @template T - 行类型
 * @param db - 数据库实例
 * @param row - 需要组装的列值
 */
export async function hydrateSpendLogRow<T extends { readonly messages?: unknown; readonly proxy_server_request?: unknown }>(
	db: NodePgDatabase<typeof schema>,
	row: T,
): Promise<T> {
	const [hydrated] = await hydrateSpendLogRows(db, [row]);
	return hydrated ?? row;
}

/**
 * 写入开关：默认开启，可用 env / DB general_settings / yaml 关闭。
 */
export async function shouldDeduplicateSpendLogBlocks(): Promise<boolean> {
	const envValue = process.env.SPEND_LOG_BLOCK_DEDUP;
	if (envValue === "true") {
		return true;
	}
	if (envValue === "false") {
		return false;
	}
	try {
		const dbGeneral = await dbConfigProvider.getParam("general_settings");
		if ("spend_log_block_dedup" in dbGeneral) {
			const configured = dbGeneral["spend_log_block_dedup"];
			if (typeof configured === "boolean") {
				return configured;
			}
			if (configured === "true" || configured === "false") {
				return configured === "true";
			}
		}
		const fromYaml = getConfig().generalSettings.spend_log_block_dedup;
		return typeof fromYaml === "boolean" ? fromYaml : true;
	} catch {
		return true;
	}
}
