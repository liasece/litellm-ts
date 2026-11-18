/**
 * 上游模型元信息：归一化结构与解析器契约。
 *
 * 七家上游给出的字段名、单位、嵌套层级都不相同（OpenCode 是 `limit.output` 与百万
 *  token 单价，Codex 是 `context_window`，CommandCode 只有 `context_length`）。这里
 * 定义代理内部唯一的形状：字段全部可选，解析器只填上游真的给出的部分，缺的保持
 * `undefined`——「上游没说不等于上游说没有」。
 */

import type { SubscriptionAccount, SubscriptionSource } from "../types";

/** 归一化后的上游模型元信息；每个字段都可缺省。 */
export interface UpstreamModelMetadata {
	/** 上游展示名。 */
	readonly displayName?: string;
	/** 上游描述。 */
	readonly description?: string;
	/** 上下文窗口（tokens）。 */
	readonly contextWindow?: number;
	/** 单次最大输出（tokens）。 */
	readonly maxOutputTokens?: number;
	/** 输入单价（per token，已从百万 token 单价换算）。 */
	readonly inputCostPerToken?: number;
	/** 输出单价（per token）。 */
	readonly outputCostPerToken?: number;
	/** 缓存读取单价（per token）。 */
	readonly cacheReadCostPerToken?: number;
	/** 缓存写入单价（per token）。 */
	readonly cacheWriteCostPerToken?: number;
	/** 是否支持工具调用。 */
	readonly supportsTools?: boolean;
	/** 是否支持推理/思考。 */
	readonly supportsReasoning?: boolean;
	/** 是否支持结构化输出。 */
	readonly supportsStructuredOutput?: boolean;
	/** 是否接受图片输入。 */
	readonly supportsVision?: boolean;
	/** 输入模态（text/image/audio/video）。 */
	readonly inputModalities?: readonly string[];
	/** 输出模态。 */
	readonly outputModalities?: readonly string[];
	/** 推理档位名称（low/medium/high/...）。 */
	readonly reasoningLevels?: readonly string[];
	/** 上游家族标识。 */
	readonly family?: string;
	/** 上游规范模型 ID（如 `zhipuai/glm-5.3`）。 */
	readonly canonicalId?: string;
	/** 上游发布日期（ISO 日期字符串）。 */
	readonly releaseDate?: string;
}

/** 来源级状态行使用的模型 ID：不指向具体模型。 */
export const UPSTREAM_SOURCE_STATUS_ID = "*";

/** 缓存行状态：拿到了 / 上游不提供 / 本次失败。 */
export type UpstreamModelMetaStatus = "ok" | "unsupported" | "error";

/** 一条持久化的上游元信息记录。 */
export interface UpstreamModelMetaRecord {
	/** 订阅来源。 */
	readonly source: SubscriptionSource;
	/** 上游模型 ID（`*` 为来源级状态行）。 */
	readonly modelId: string;
	/** 状态。 */
	readonly status: UpstreamModelMetaStatus;
	/** 上游展示名。 */
	readonly displayName?: string;
	/** 归一化字段；`error`/`unsupported` 时可能为空。 */
	readonly metadata?: UpstreamModelMetadata;
	/** 上游原始条目精简版（排查用）。 */
	readonly raw?: unknown;
	/** 失败原因（不含凭据）。 */
	readonly error?: string;
	/** 抓取时间。 */
	readonly fetchedAt: Date;
	/** 过期时间；过期后仍可作为 stale 值读取。 */
	readonly expiresAt: Date;
}

/** 解析器输出：上游模型 ID → 归一化元信息。 */
export type UpstreamModelMetadataMap = ReadonlyMap<string, UpstreamModelMetadata>;

/** 拉取元信息时可用的依赖。 */
export interface UpstreamSourceFetchContext {
	/** 选中账号（已排除禁用账号）。 */
	readonly account: SubscriptionAccount;
	/** fetch 实现；测试注入。 */
	readonly fetchImpl: typeof fetch;
	/** 单次请求超时（毫秒）。 */
	readonly timeoutMs: number;
}

/**
 * 一家上游的元信息适配器。
 *
 * `supported = false` 表示这家上游没有可用的模型元信息接口，服务只记一条 unsupported
 * 状态行并进入负缓存，不发起网络请求。
 */
export interface UpstreamSourceAdapter {
	/** 来源。 */
	readonly source: SubscriptionSource;
	/** 是否存在可用的元信息接口。 */
	readonly supported: boolean;
	/** 该账号是否具备调用所需的凭据。 */
	hasCredential(account: SubscriptionAccount): boolean;
	/** 拉取原始条目；返回 `null` 表示这次拉不到但接口本身存在。 */
	list(context: UpstreamSourceFetchContext): Promise<readonly unknown[] | null>;
	/** 把原始条目解析成归一化元信息；必须容忍未知字段。 */
	parse(entries: readonly unknown[]): UpstreamModelMetadataMap;
}
