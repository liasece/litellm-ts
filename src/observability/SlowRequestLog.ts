/**
 * 慢请求环形缓冲。
 *
 * 直方图只说明「哪一类慢」，事故现场还需要「刚才是哪几个请求慢、慢在哪个阶段」。
 * 这里保留最近 N 条超过阈值或失败的请求摘要，供 `/metrics/slow` 与日志对照；
 * 只存数字与归一化标签，不存请求体、响应体或 Header。
 */

/** 一条慢请求摘要。 */
export interface SlowRequestRecord {
	/** 记录时刻（ISO-8601） */
	readonly at: string;
	/** 轨迹 ID，可与日志中的 traceId 关联 */
	readonly trace_id: string;
	/** HTTP 方法 */
	readonly method: string;
	/** 归一化路由 */
	readonly route: string;
	/** HTTP 状态码 */
	readonly status: number;
	/** 客户端请求的模型名 */
	readonly model?: string;
	/** 上游主机 */
	readonly provider?: string;
	/** 是否流式 */
	readonly stream: boolean;
	/** 是否客户端提前断开 */
	readonly aborted: boolean;
	/** 端到端耗时（毫秒） */
	readonly total_ms: number;
	/** 传输首字节耗时（毫秒，含心跳/填充帧） */
	readonly first_byte_ms?: number;
	/** 首内容耗时（毫秒） */
	readonly ttfb_ms?: number;
	/** 上游请求发出前的本地耗时（毫秒） */
	readonly pre_upstream_ms?: number;
	/** 上游等待响应头耗时（毫秒） */
	readonly upstream_headers_ms?: number;
	/** 代理转换开销（毫秒） */
	readonly proxy_overhead_ms?: number;
	/** 流式传输时长（毫秒） */
	readonly stream_ms?: number;
	/** 写回客户端字节数 */
	readonly bytes_out: number;
	/** 响应结束前累计的数据库往返次数 */
	readonly db_queries: number;
}

/** 环形缓冲容量：足够覆盖一次事故窗口，又不至于让内存报表失控。 */
const CAPACITY = 40;

const buffer: SlowRequestRecord[] = [];

/**
 * 写入一条慢请求摘要；容量满时覆盖最旧一条。
 * @param record - 摘要
 */
export function recordSlowRequest(record: SlowRequestRecord): void {
	if (buffer.length >= CAPACITY) {
		buffer.shift();
	}
	buffer.push(record);
}

/**
 * 读取最近的慢请求摘要，最新的在前。
 * @param limit - 最多返回条数
 */
export function recentSlowRequests(limit = CAPACITY): SlowRequestRecord[] {
	const slice = buffer.slice(Math.max(0, buffer.length - limit));
	return slice.reverse();
}

/** 清空缓冲；仅供测试使用。 */
export function resetSlowRequests(): void {
	buffer.length = 0;
}
