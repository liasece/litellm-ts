/**
 * 线上性能观测所用的全部指标定义。
 *
 * 命名约定：
 * - 前缀 `litellm_`，单位后缀统一用 `_seconds` / `_bytes` / `_total`（Prometheus 约定）；
 * - 标签只放低基数维度：路由类别、模型组、Provider、结果、状态码。请求 ID、Key、
 *   完整 URL 一律不进标签，避免序列爆炸；需要逐请求细节时看慢请求日志。
 */

import { Counter, Gauge, Histogram, MetricRegistry } from "./Metrics";
import type { MetricLabels } from "./Metrics";

/** 进程内全局指标注册表。 */
export const metricsRegistry = new MetricRegistry();

/** 按路由统计的请求耗时桶（秒）：覆盖缓存命中的毫秒级到报表页的数十秒。 */
const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60] as const;

/** 推理请求端到端耗时桶（秒）：LLM 响应以秒计，最长留到 5 分钟。 */
const LLM_DURATION_BUCKETS = [0.1, 0.25, 0.5, 1, 2, 3, 5, 8, 13, 21, 34, 55, 90, 150, 300] as const;

/** 首字耗时桶（秒）。 */
const TTFB_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 8, 13, 21, 34, 55] as const;

/** 上游等待响应头耗时桶（秒）：包含建连、排队与上游首包。 */
const UPSTREAM_HEADERS_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 8, 13, 21, 34] as const;

/** 代理自身转换开销桶（秒）：正常应在毫秒级。 */
const PROXY_OVERHEAD_BUCKETS = [0.001, 0.0025, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5] as const;

/** 流式传输时长桶（秒）：首字节之后到最后一个字节。 */
const STREAM_BUCKETS = [0.1, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1800] as const;

/** 数据库语句耗时桶（秒）。 */
const DB_DURATION_BUCKETS = [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5] as const;

/** 连接池取连接等待桶（秒）。 */
const POOL_WAIT_BUCKETS = [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 5] as const;

/** 响应体字节桶。 */
const DB_ROUNDTRIP_BUCKETS = [0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 64] as const;
const RESPONSE_BYTES_BUCKETS = [1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864] as const;

/** GC 暂停时长桶（秒）。 */
const GC_DURATION_BUCKETS = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25] as const;

/** HTTP 请求总数，按路由/方法/状态码分类。 */
export const httpRequestsTotal = metricsRegistry.register(
	new Counter("litellm_http_requests_total", "HTTP 请求数（按路由、方法与状态码）", ["route", "method", "status"]),
);

/** HTTP 请求端到端耗时。 */
export const httpRequestDuration = metricsRegistry.register(
	new Histogram("litellm_http_request_duration_seconds", "HTTP 请求端到端耗时", ["route", "method"], HTTP_DURATION_BUCKETS),
);

/** HTTP 响应体字节数。 */
export const httpResponseBytes = metricsRegistry.register(
	new Histogram("litellm_http_response_bytes", "HTTP 响应体字节数", ["route"], RESPONSE_BYTES_BUCKETS),
);

/** 当前正在处理的请求数。 */
export const httpInFlight = metricsRegistry.register(new Gauge("litellm_http_in_flight", "当前在处理的 HTTP 请求数"));

/** 推理请求数，按模型组/Provider/流式与结果分类。 */
export const llmRequestsTotal = metricsRegistry.register(
	new Counter("litellm_llm_requests_total", "推理请求数（按模型组、Provider、流式与结果）", [
		"model",
		"provider",
		"stream",
		"status",
	]),
);

/** 推理请求端到端耗时（客户端视角，含流式传输时长）。 */
export const llmRequestDuration = metricsRegistry.register(
	new Histogram("litellm_llm_request_duration_seconds", "推理请求端到端耗时", ["model", "stream"], LLM_DURATION_BUCKETS),
);

/** 传输首字节耗时：可能只是心跳或填充帧，用于区分「协议前言早到」与「模型晚到」。 */
export const llmFirstByte = metricsRegistry.register(
	new Histogram("litellm_llm_first_byte_seconds", "客户端收到第一个字节的耗时（含心跳与填充帧）", ["model", "stream"], TTFB_BUCKETS),
);

/** 推理请求首字节耗时（客户端视角 TTFB）。 */
export const llmTtfb = metricsRegistry.register(
	new Histogram("litellm_llm_ttfb_seconds", "推理请求首字节耗时", ["model", "stream"], TTFB_BUCKETS),
);

/** 上游请求发出前的本地耗时（请求体解析 + 鉴权 + 路由）。 */
export const llmPreUpstream = metricsRegistry.register(
	new Histogram("litellm_llm_pre_upstream_seconds", "上游请求发出前的本地耗时", ["model"], HTTP_DURATION_BUCKETS),
);

/** 上游调用前的数据库往返次数：直接对应「鉴权 + 运行时配置 + 在途登记」的扇出规模。 */
export const llmPreUpstreamDbQueries = metricsRegistry.register(
	new Histogram(
		"litellm_llm_pre_upstream_db_queries",
		"推理请求在调用上游前累计的数据库往返次数",
		[],
		DB_ROUNDTRIP_BUCKETS,
	),
);

/** 上游等待响应头耗时。 */
export const llmUpstreamHeaders = metricsRegistry.register(
	new Histogram("litellm_llm_upstream_headers_seconds", "上游等待响应头耗时", ["provider"], UPSTREAM_HEADERS_BUCKETS),
);

/** 代理自身转换开销：上游已产出首个内容到客户端收到首字节。 */
export const llmProxyOverhead = metricsRegistry.register(
	new Histogram("litellm_llm_proxy_overhead_seconds", "代理转换与写出开销", ["model"], PROXY_OVERHEAD_BUCKETS),
);

/** 流式传输时长：客户端首字节到响应结束。 */
export const llmStreamDuration = metricsRegistry.register(
	new Histogram("litellm_llm_stream_duration_seconds", "流式传输时长", ["model"], STREAM_BUCKETS),
);

/** 上游尝试次数，按 Provider 与结果分类（含重试与 fallback）。 */
export const llmUpstreamAttempts = metricsRegistry.register(
	new Counter("litellm_llm_upstream_attempts_total", "上游尝试次数", ["provider", "outcome"]),
);

/** Token 用量，按模型组与方向分类，用于计算输出吞吐。 */
export const llmTokensTotal = metricsRegistry.register(
	new Counter("litellm_llm_tokens_total", "Token 用量（按模型组与方向）", ["model", "kind"]),
);

/** 数据库语句数。 */
export const dbQueriesTotal = metricsRegistry.register(
	new Counter("litellm_db_queries_total", "数据库语句数（按语句类型与结果）", ["op", "outcome"]),
);

/** 数据库语句耗时。 */
export const dbQueryDuration = metricsRegistry.register(
	new Histogram("litellm_db_query_duration_seconds", "数据库语句耗时", ["op"], DB_DURATION_BUCKETS),
);

/** 连接池取连接等待耗时。 */
export const dbPoolWait = metricsRegistry.register(
	new Histogram("litellm_db_pool_wait_seconds", "连接池取连接等待耗时", [], POOL_WAIT_BUCKETS),
);

/** 连接池连接数，按状态分类（total / idle / waiting）。 */
export const dbPoolConnections = metricsRegistry.register(
	new Gauge("litellm_db_pool_connections", "连接池连接数（按状态）", ["state"]),
);

/** 超过阈值的慢语句数。 */
export const dbSlowQueriesTotal = metricsRegistry.register(
	new Counter("litellm_db_slow_queries_total", "慢语句数", ["op"]),
);

/** 事务提交后的记账落库耗时。 */
export const spendWriteDuration = metricsRegistry.register(
	new Histogram("litellm_spend_write_seconds", "记账落库耗时", [], DB_DURATION_BUCKETS),
);

/** 记账落库失败数。 */
export const spendWriteFailuresTotal = metricsRegistry.register(
	new Counter("litellm_spend_write_failures_total", "记账落库失败数"),
);

/** 结算队列写库结果：written 落库成功，failed 失败并重排，overflow 队列满改同步写。 */
export const spendSettlementWrites = metricsRegistry.register(
	new Counter("litellm_spend_settlement_writes_total", "结算队列写库次数", ["outcome"]),
);

/** 结算队列当前积压条数；持续 >0 说明落库跟不上请求。 */
export const spendSettlementPending = metricsRegistry.register(
	new Gauge("litellm_spend_settlement_pending", "结算队列积压条数"),
);

/** 流式 checkpoint 写库结果：written 实际写入，skipped 内容未变跳过，failed 写失败。 */
export const streamCheckpointWrites = metricsRegistry.register(
	new Counter("litellm_llm_stream_checkpoint_writes_total", "流式 checkpoint 写库次数", ["outcome"]),
);

/** 事件循环延迟分位数（最近一次采样区间）。 */
export const eventLoopDelay = metricsRegistry.register(
	new Gauge("litellm_process_event_loop_delay_seconds", "事件循环延迟分位数（最近采样区间）", ["quantile"]),
);

/** 事件循环延迟最大值（自进程启动）。 */
export const eventLoopDelayMax = metricsRegistry.register(
	new Gauge("litellm_process_event_loop_delay_max_seconds", "事件循环延迟最大值（自启动以来）"),
);

/** 进程内存占用，按种类分类。 */
export const processMemory = metricsRegistry.register(
	new Gauge("litellm_process_memory_bytes", "进程内存占用（按种类）", ["kind"]),
);

/** 进程 CPU 时间。 */
export const processCpuSeconds = metricsRegistry.register(
	new Counter("litellm_process_cpu_seconds_total", "进程 CPU 时间（按 user/system）", ["mode"]),
);

/** 进程运行时长。 */
export const processUptime = metricsRegistry.register(new Gauge("litellm_process_uptime_seconds", "进程运行时长"));

/** 进程启动时刻（Unix 秒）。 */
export const processStartTime = metricsRegistry.register(
	new Gauge("litellm_process_start_time_seconds", "进程启动时刻（Unix 秒）"),
);

/** 进程活跃句柄/请求数。 */
export const processActiveResources = metricsRegistry.register(
	new Gauge("litellm_process_active_resources", "进程活跃资源数（按类型）", ["kind"]),
);

/** GC 暂停耗时。 */
export const gcDuration = metricsRegistry.register(
	new Histogram("litellm_nodejs_gc_duration_seconds", "GC 暂停耗时", ["kind"], GC_DURATION_BUCKETS),
);

/** GC 次数。 */
export const gcCollections = metricsRegistry.register(
	new Counter("litellm_nodejs_gc_collections_total", "GC 次数（按 kind）", ["kind"]),
);

/** 观测自身因序列上限被丢弃的观测数（抓取时刷新）。 */
export const droppedSeries = metricsRegistry.register(
	new Gauge("litellm_observability_dropped_series", "因序列上限被丢弃的观测数"),
);

/**
 * 读取某个计数器里所有序列的标签值集合，用于报表按维度聚合。
 * @param counter - 计数器
 * @param labelName - 维度名
 */
export function distinctLabelValues(counter: Counter, labelName: string): string[] {
	const seen = new Set<string>();
	for (const item of counter.snapshot()) {
		const value = item.labels[labelName];
		if (value !== undefined && value.length > 0) {
			seen.add(value);
		}
	}
	return Array.from(seen);
}

/**
 * 按标签过滤后求和，供错误率一类聚合使用。
 * @param counter - 计数器
 * @param predicate - 过滤条件
 */
export function sumCounter(counter: Counter, predicate?: (labels: MetricLabels) => boolean): number {
	return counter.sumWhere(predicate);
}
