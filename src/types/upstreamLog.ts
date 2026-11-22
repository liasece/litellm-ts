/**
 * 上游请求/响应的诊断上下文（最终 SpendLog 详细列与在途补写的共同形状）。
 *
 * 从 `router/UpstreamLogContext.ts`、`router/UpstreamExchange.ts` 抽出：这两个模块互相
 * 引用（记录通道 ↔ 上下文构造），而本文件只是数据。仓储、schema 与类型层要标注这些列时
 * 只依赖它，不会再被卷进 router 的依赖环。
 */
import type { UpstreamAccountRef } from "../router/UpstreamKeyIdentity";
import type { DeploymentSpendInfo } from "./spendInfo";

/** 可写入详细 SpendLog 的上游请求。 */
export interface UpstreamRequestLog {
	/** 最终请求 URL。 */
	readonly url: string;
	/** HTTP 方法。 */
	readonly method: string;
	/** 请求头（原样记录）。 */
	readonly headers: Record<string, string>;
	/** Provider 转换后的 JSON 请求体。 */
	readonly body: unknown;
}

/** 可写入详细 SpendLog 的上游响应。 */
export interface UpstreamResponseLog {
	/** 上游 HTTP 状态码。 */
	readonly status_code: number;
	/** 响应头（原样记录）。 */
	readonly headers: Record<string, string>;
	/** 已解析的非流式响应体，或流式协议终态事件携带的完整响应对象。 */
	readonly body?: unknown;
}

/** 单次最终 Provider 调用的请求/响应上下文。 */
export interface UpstreamLogContext {
	/** Actual deployment of this exchange, including failed calls. Never serialized with request payloads. */
	readonly spendInfo?: DeploymentSpendInfo;
	/** 本次实际 key 的 SHA-256；未记录时缺省。 */
	readonly upstreamKeyHash?: string;
	/** 本次实际使用该 key 的账号/凭据；inline key 缺省。 */
	readonly upstreamAccount?: UpstreamAccountRef;
	/** 实际上游请求。 */
	readonly request: UpstreamRequestLog;
	/** 实际上游响应；网络层失败时可能不存在。 */
	readonly response?: UpstreamResponseLog;
}

/** 一次失败的上游调用在 SpendLog 里留下的错误记录（已脱敏）。 */
export interface UpstreamErrorRecord {
	/** 发出该次请求的上游地址。 */
	readonly url: string;
	/** 上游返回的 HTTP 状态码。 */
	readonly status_code: number;
	/** 上游错误类别或供应商错误码。 */
	readonly type: string;
	/** 已脱敏的错误文案，过长时截断。 */
	readonly message: string;
}
