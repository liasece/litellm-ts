/**
 * 观测概览报表：把指标注册表汇总成一份人能直接读的 JSON。
 *
 * 为什么还要 JSON：Prometheus 文本适合机器抓取，但事故现场需要「一眼看到 p95、
 * 错误率、连接池水位、最近几条慢请求」。报表只读取窗口内的分片，不做 SQL 聚合，
 * 因此任何时刻请求都很快，也不会给数据库增加负担。
 */

import { quantileFromBuckets } from "./Metrics";
import type { HistogramWindowSnapshot, MetricLabels } from "./Metrics";
import type { Histogram as HistogramType } from "./Metrics";
import {
	metricsRegistry,
	dbPoolConnections,
	dbPoolWait,
	dbQueriesTotal,
	dbQueryDuration,
	dbSlowQueriesTotal,
	eventLoopDelay,
	eventLoopDelayMax,
	gcCollections,
	gcDuration,
	httpInFlight,
	httpRequestDuration,
	httpRequestsTotal,
	httpResponseBytes,
	llmPreUpstream,
	llmPreUpstreamDbQueries,
	llmProxyOverhead,
	llmRequestDuration,
	llmRequestsTotal,
	llmStreamDuration,
	llmTokensTotal,
	llmFirstByte,
	llmTtfb,
	llmUpstreamAttempts,
	llmUpstreamHeaders,
	processActiveResources,
	processCpuSeconds,
	processUptime,
	spendWriteDuration,
	spendWriteFailuresTotal,
} from "./MetricCatalog";
import { recentSlowRequests } from "./SlowRequestLog";

/** 默认统计窗口：5 分钟，够短到反映当前状态，够长到包含几十个推理请求。 */
export const DEFAULT_REPORT_WINDOW_SECONDS = 300;

/** 报表里单张表最多返回的分组数。 */
const MAX_GROUPS = 15;

/**
 * 毫秒保留一位小数。
 * @param value - 秒或毫秒数值
 */
function round(value: number | undefined): number | undefined {
	if (value === undefined || !Number.isFinite(value)) {
		return undefined;
	}
	return Math.round(value * 10) / 10;
}

/**
 * 秒转毫秒。
 * @param seconds - 秒
 */
function toMs(seconds: number | undefined): number | undefined {
	return seconds === undefined ? undefined : round(seconds * 1000);
}

/**
 * 按比例计算，分母为 0 时返回 0。
 * @param numerator - 分子
 * @param denominator - 分母
 */
function ratio(numerator: number, denominator: number): number {
	if (denominator <= 0) {
		return 0;
	}
	return Math.round((numerator / denominator) * 10_000) / 10_000;
}

/**
 * 合并多条窗口快照的桶计数。
 * @param snapshots - 快照列表
 */
function mergeSnapshots(snapshots: readonly HistogramWindowSnapshot[]): {
	count: number;
	sum: number;
	cumulative: number[];
} {
	let count = 0;
	let sum = 0;
	const cumulative: number[] = [];
	for (const snapshot of snapshots) {
		count += snapshot.count;
		sum += snapshot.sum;
		for (let index = 0; index < snapshot.cumulative.length; index += 1) {
			cumulative[index] = (cumulative[index] ?? 0) + (snapshot.cumulative[index] ?? 0);
		}
	}
	return { count: count, sum: sum, cumulative: cumulative };
}

/**
 * 直方图的整体分位数描述。
 * @param histogram - 直方图
 * @param windowMs - 窗口长度
 * @param predicate - 序列过滤
 */
function describeHistogram(
	histogram: HistogramType,
	windowMs: number,
	predicate?: (labels: MetricLabels) => boolean,
): {
	count: number;
	mean_ms: number | undefined;
	p50_ms: number | undefined;
	p95_ms: number | undefined;
	p99_ms: number | undefined;
} {
	const snapshots = histogram.windowSnapshot(windowMs).filter((item) => predicate === undefined || predicate(item.labels));
	const merged = mergeSnapshots(snapshots);
	const summary = (quantile: number): number | undefined =>
		toMs(quantileFromBuckets(histogram.buckets, merged.cumulative, merged.count, quantile));
	return {
		count: merged.count,
		mean_ms: merged.count > 0 ? round((merged.sum / merged.count) * 1000) : undefined,
		p50_ms: summary(0.5),
		p95_ms: summary(0.95),
		p99_ms: summary(0.99),
	};
}

/**
 * 直方图的整体分位数描述（按原始单位，不做秒转毫秒）。
 * 用于「往返次数」这类本来就是计数的直方图。
 * @param histogram - 直方图
 * @param windowMs - 窗口长度
 */
function describeCounts(
	histogram: HistogramType,
	windowMs: number,
): {
	count: number;
	mean: number | undefined;
	p50: number | undefined;
	p95: number | undefined;
	p99: number | undefined;
} {
	const merged = mergeSnapshots(histogram.windowSnapshot(windowMs));
	const summary = (quantile: number): number | undefined =>
		round(quantileFromBuckets(histogram.buckets, merged.cumulative, merged.count, quantile));
	return {
		count: merged.count,
		mean: merged.count > 0 ? round(merged.sum / merged.count) : undefined,
		p50: summary(0.5),
		p95: summary(0.95),
		p99: summary(0.99),
	};
}

/**
 * 按若干标签聚合直方图，返回带分位数的分组行。
 * @param histogram - 直方图
 * @param groupKeys - 分组标签
 * @param windowMs - 窗口长度
 */
function groupHistogram(
	histogram: HistogramType,
	groupKeys: readonly string[],
	windowMs: number,
): Array<{
	labels: MetricLabels;
	count: number;
	mean_ms: number | undefined;
	p50_ms: number | undefined;
	p95_ms: number | undefined;
	p99_ms: number | undefined;
}> {
	const groups = new Map<string, { labels: MetricLabels; snapshots: HistogramWindowSnapshot[] }>();
	for (const snapshot of histogram.windowSnapshot(windowMs)) {
		const key = groupKeys.map((name) => snapshot.labels[name] ?? "").join("\u0001");
		const existing = groups.get(key);
		if (existing === undefined) {
			groups.set(key, { labels: snapshot.labels, snapshots: [snapshot] });
			continue;
		}
		existing.snapshots.push(snapshot);
	}
	const rows = Array.from(groups.values()).map((group) => {
		const merged = mergeSnapshots(group.snapshots);
		const summary = (quantile: number): number | undefined =>
			toMs(quantileFromBuckets(histogram.buckets, merged.cumulative, merged.count, quantile));
		return {
			labels: group.labels,
			count: merged.count,
			mean_ms: merged.count > 0 ? round((merged.sum / merged.count) * 1000) : undefined,
			p50_ms: summary(0.5),
			p95_ms: summary(0.95),
			p99_ms: summary(0.99),
		};
	});
	rows.sort((left, right) => right.count - left.count);
	return rows.slice(0, MAX_GROUPS);
}

/**
 * 读取无标签直方图在窗口内的样本总和（秒）。
 * @param histogram - 直方图
 * @param windowMs - 窗口长度
 * @param predicate - 序列过滤
 */
function sumSeconds(
	histogram: HistogramType,
	windowMs: number,
	predicate?: (labels: MetricLabels) => boolean,
): number {
	return mergeSnapshots(
		histogram.windowSnapshot(windowMs).filter((item) => predicate === undefined || predicate(item.labels)),
	).sum;
}

/**
 * 读取仪表值。
 * @param gauge - 仪表
 * @param labelName - 标签名
 * @param labelValue - 标签值
 */
function gaugeValue(gauge: { value: (labels?: MetricLabels) => number }, labelName?: string, labelValue?: string): number {
	if (labelName === undefined || labelValue === undefined) {
		return gauge.value();
	}
	return gauge.value({ [labelName]: labelValue });
}

/**
 * 构造观测概览。
 * @param windowSeconds - 统计窗口（秒）
 */
export function buildObservabilitySummary(windowSeconds: number = DEFAULT_REPORT_WINDOW_SECONDS) {
	// 连接池水位、被丢弃序列这类「当前值」只在抓取回调里刷新；报表要看到同一份现场，
	// 否则尚未被抓取过的进程会报出 0 连接、0 上限。
	metricsRegistry.runScrapeHooks();
	const windowMs = Math.max(15, Math.min(3_600, windowSeconds)) * 1000;
	const http = summarizeHttp(windowMs);
	const llm = summarizeLlm(windowMs);
	const db = summarizeDatabase(windowMs);
	const processInfo = summarizeProcess();
	const spendWrites = describeHistogram(spendWriteDuration, windowMs);
	return {
		generated_at: new Date().toISOString(),
		window_seconds: windowMs / 1000,
		node: process.version,
		process: processInfo,
		http: http,
		llm: llm,
		db: db,
		spend: {
			writes: spendWrites.count,
			p95_ms: spendWrites.p95_ms,
			mean_ms: spendWrites.mean_ms,
			failures: spendWriteFailuresTotal.windowValue(undefined, windowMs),
		},
		top_slow: recentSlowRequests(10),
	};
}

/**
 * 汇总 HTTP 维度。
 * @param windowMs - 窗口长度
 */
function summarizeHttp(windowMs: number) {
	const requests = httpRequestsTotal.sumWhereInWindow(windowMs);
	const serverErrors = httpRequestsTotal.sumWhereInWindow(windowMs, (labels) => (labels["status"] ?? "").startsWith("5"));
	const clientErrors = httpRequestsTotal.sumWhereInWindow(windowMs, (labels) => (labels["status"] ?? "").startsWith("4"));
	const byStatus = httpRequestsTotal
		.windowSnapshot(windowMs)
		.map((item) => ({ status: item.labels["status"] ?? "unknown", count: item.value }))
		.filter((item) => item.count > 0);
	const byStatusMerged = new Map<string, number>();
	for (const item of byStatus) {
		byStatusMerged.set(item.status, (byStatusMerged.get(item.status) ?? 0) + item.count);
	}
	const routeRows = groupHistogram(httpRequestDuration, ["route", "method"], windowMs).map((row) => ({
		route: row.labels["route"] ?? "unknown",
		method: row.labels["method"] ?? "unknown",
		requests: row.count,
		p50_ms: row.p50_ms,
		p95_ms: row.p95_ms,
		p99_ms: row.p99_ms,
	}));
	const bytesMerged = mergeSnapshots(httpResponseBytes.windowSnapshot(windowMs));
	return {
		requests: requests,
		rps: Math.round((requests / (windowMs / 1000)) * 100) / 100,
		in_flight: httpInFlight.value(),
		errors: serverErrors,
		client_errors: clientErrors,
		error_rate: ratio(serverErrors, requests),
		latency_ms: describeHistogram(httpRequestDuration, windowMs),
		response_bytes_mean: bytesMerged.count > 0 ? Math.round(bytesMerged.sum / bytesMerged.count) : undefined,
		by_status: Array.from(byStatusMerged.entries())
			.map(([status, count]) => ({ status: status, count: count }))
			.sort((left, right) => right.count - left.count),
		by_route: routeRows,
	};
}

/**
 * 汇总推理维度。
 * @param windowMs - 窗口长度
 */
function summarizeLlm(windowMs: number) {
	const requests = llmRequestsTotal.sumWhereInWindow(windowMs);
	const errors = llmRequestsTotal.sumWhereInWindow(windowMs, (labels) => labels["status"] === "error");
	const aborted = llmRequestsTotal.sumWhereInWindow(windowMs, (labels) => labels["status"] === "aborted");
	const streams = llmRequestsTotal.sumWhereInWindow(windowMs, (labels) => labels["stream"] === "true");
	const promptTokens = llmTokensTotal.sumWhereInWindow(windowMs, (labels) => labels["kind"] === "prompt");
	const completionTokens = llmTokensTotal.sumWhereInWindow(windowMs, (labels) => labels["kind"] === "completion");
	const streamSeconds = sumSeconds(llmStreamDuration, windowMs);
	const providerRows = new Map<string, { provider: string; attempts: number; errors: number }>();
	for (const item of llmUpstreamAttempts.windowSnapshot(windowMs)) {
		const provider = item.labels["provider"] ?? "unknown";
		const row = providerRows.get(provider) ?? { provider: provider, attempts: 0, errors: 0 };
		row.attempts += item.value;
		if (item.labels["outcome"] === "error") {
			row.errors += item.value;
		}
		providerRows.set(provider, row);
	}
	const modelRows = groupHistogram(llmRequestDuration, ["model", "stream"], windowMs).map((row) => {
		const model = row.labels["model"] ?? "unknown";
		return {
			model: model,
			stream: row.labels["stream"] === "true",
			requests: row.count,
			p50_ms: row.p50_ms,
			p95_ms: row.p95_ms,
			p99_ms: row.p99_ms,
			errors: llmRequestsTotal.sumWhereInWindow(
				windowMs,
				(labels) => labels["model"] === model && labels["status"] === "error",
			),
		};
	});
	return {
		requests: requests,
		streams: streams,
		errors: errors,
		aborted: aborted,
		error_rate: ratio(errors, requests),
		first_byte_ms: describeHistogram(llmFirstByte, windowMs),
		ttfb_ms: describeHistogram(llmTtfb, windowMs),
		duration_ms: describeHistogram(llmRequestDuration, windowMs),
		pre_upstream_ms: describeHistogram(llmPreUpstream, windowMs),
		pre_upstream_db_queries: describeCounts(llmPreUpstreamDbQueries, windowMs),
		upstream_headers_ms: describeHistogram(llmUpstreamHeaders, windowMs),
		proxy_overhead_ms: describeHistogram(llmProxyOverhead, windowMs),
		stream_ms: describeHistogram(llmStreamDuration, windowMs),
		tokens: {
			prompt: promptTokens,
			completion: completionTokens,
			output_tps: streamSeconds > 0 ? Math.round((completionTokens / streamSeconds) * 10) / 10 : undefined,
		},
		by_model: modelRows,
		by_provider: Array.from(providerRows.values()).sort((left, right) => right.attempts - left.attempts).slice(0, MAX_GROUPS),
	};
}

/**
 * 汇总数据库维度。
 * @param windowMs - 窗口长度
 */
function summarizeDatabase(windowMs: number) {
	const queries = dbQueriesTotal.sumWhereInWindow(windowMs);
	const errors = dbQueriesTotal.sumWhereInWindow(windowMs, (labels) => labels["outcome"] === "error");
	const byOp = groupHistogram(dbQueryDuration, ["op"], windowMs).map((row) => ({
		op: row.labels["op"] ?? "OTHER",
		queries: row.count,
		p50_ms: row.p50_ms,
		p95_ms: row.p95_ms,
		p99_ms: row.p99_ms,
	}));
	return {
		queries: queries,
		errors: errors,
		error_rate: ratio(errors, queries),
		qps: Math.round((queries / (windowMs / 1000)) * 100) / 100,
		duration_ms: describeHistogram(dbQueryDuration, windowMs),
		wait_ms: describeHistogram(dbPoolWait, windowMs),
		slow_queries: dbSlowQueriesTotal.windowValue(undefined, windowMs),
		pool: {
			total: gaugeValue(dbPoolConnections, "state", "total"),
			idle: gaugeValue(dbPoolConnections, "state", "idle"),
			waiting: gaugeValue(dbPoolConnections, "state", "waiting"),
			max: gaugeValue(dbPoolConnections, "state", "max"),
		},
		by_op: byOp,
	};
}

/**
 * 汇总进程维度。
 */
function summarizeProcess() {
	const gcPause = describeHistogram(gcDuration, 300_000);
	// 内存直接现取：报表要反映抓取这一刻的真实占用，不能等下一次采样周期。
	const memory = process.memoryUsage();
	const activeResources: Record<string, number> = {};
	for (const item of processActiveResources.snapshot()) {
		const kind = item.labels["kind"];
		if (kind !== undefined) {
			activeResources[kind] = item.value;
		}
	}
	return {
		uptime_seconds: Math.round(processUptime.value()),
		memory_bytes: {
			rss: memory.rss,
			heap_used: memory.heapUsed,
			heap_total: memory.heapTotal,
			external: memory.external,
		},
		event_loop_delay_ms: {
			p50: round(eventLoopDelay.value({ quantile: "0.5" }) * 1000),
			p95: round(eventLoopDelay.value({ quantile: "0.95" }) * 1000),
			p99: round(eventLoopDelay.value({ quantile: "0.99" }) * 1000),
			max: round(eventLoopDelayMax.value() * 1000),
			sampled_at: new Date().toISOString(),
		},
		cpu_seconds: {
			user: Math.round(processCpuSeconds.value({ mode: "user" }) * 10) / 10,
			system: Math.round(processCpuSeconds.value({ mode: "system" }) * 10) / 10,
		},
		gc: {
			collections: gcCollections.sumWhere(),
			pause_p95_ms: gcPause.p95_ms,
			pause_p99_ms: gcPause.p99_ms,
		},
		active_resources: activeResources,
	};
}
