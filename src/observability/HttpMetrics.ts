/**
 * HTTP 层观测中间件：建立请求轨迹、记录分阶段耗时与慢请求。
 *
 * 它必须是第一个中间件：只有这样「请求到达」才是真实入口时刻，后面的请求体解析、
 * 鉴权、路由与上游等待才能被拆开计时。记录点选在 res.write/res.end 与 finish/close
 * 事件上，因此对聊天、Messages、Responses、CLIProxy 透传、管理接口一视同仁，
 * 不需要在每个端点里复制埋点。
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { performance } from "node:perf_hooks";
import { createModuleLogger } from "../core/utils/logger";
import {
	httpInFlight,
	httpRequestDuration,
	httpRequestsTotal,
	httpResponseBytes,
	llmFirstByte,
	llmPreUpstream,
	llmPreUpstreamDbQueries,
	llmProxyOverhead,
	llmRequestDuration,
	llmRequestsTotal,
	llmStreamDuration,
	llmTtfb,
	llmUpstreamAttempts,
	llmUpstreamHeaders,
} from "./MetricCatalog";
import { classifyRoute } from "./RouteClassifier";
import {
	annotateRequestTrace,
	computeTimingBreakdown,
	createRequestTrace,
	runWithRequestTrace,
} from "./RequestTrace";
import type { RequestTimingBreakdown, RequestTraceState } from "./RequestTrace";
import { recordSlowRequest } from "./SlowRequestLog";

const logger = createModuleLogger("Observability:HTTP");

/** 非推理请求超过该耗时记为慢请求（毫秒）。 */
export const SLOW_REQUEST_MS = 2_000;

/** 推理请求首字节超过该耗时记为慢请求（毫秒）：上游首包慢会直接拖垮客户端体验。 */
export const SLOW_LLM_TTFB_MS = 3_000;

/** 推理请求总耗时超过该值记为慢请求（毫秒）。 */
export const SLOW_LLM_TOTAL_MS = 120_000;

/** 标记响应已被观测包装，避免重复安装。 */
const INSTRUMENTED = Symbol("observability.instrumented");

/** 观测开关的环境变量名；置 `false` 关闭全部采集。 */
export const OBSERVABILITY_ENABLED_ENV = "LITELLM_OBSERVABILITY_ENABLED";

/** 缓存的开关状态；进程启动后不再变化，避免每请求读环境变量。 */
let enabledCache: boolean | null = null;

/**
 * 观测是否启用。
 */
export function isObservabilityEnabled(): boolean {
	if (enabledCache === null) {
		enabledCache = process.env[OBSERVABILITY_ENABLED_ENV] !== "false";
	}
	return enabledCache;
}

/**
 * 覆盖观测开关；仅供测试使用。
 * @param value - 开关值
 */
export function setObservabilityEnabledForTests(value: boolean | null): void {
	enabledCache = value;
}

/** 被观测包装过的响应对象字段。 */
interface InstrumentedResponse {
	[INSTRUMENTED]?: boolean;
}

/**
 * 推理路由前缀：CLIProxy 透传直接 pipe 上游字节，没有「上游尝试」记录，
 * 仅靠 attempts 判空会把这类流量漏在 LLM 指标之外——它恰好是当前最大的流量来源。
 */
const INFERENCE_ROUTE_PREFIXES = ["/v1/chat/completions", "/v1/messages", "/v1/completions", "/v1/responses", "/responses"] as const;

/**
 * 是否为推理路由。
 * @param route - 归一化路由
 */
function isInferenceRoute(route: string): boolean {
	for (const prefix of INFERENCE_ROUTE_PREFIXES) {
		if (route === prefix || route.startsWith(`${prefix}/`)) {
			return true;
		}
	}
	return false;
}

/**
 * 请求体解析完成标记中间件：必须紧跟在 `express.json()` 之后。
 * @param _req - Express 请求
 * @param _res - Express 响应
 * @param next - 下一个中间件
 */
export function markBodyParsed(_req: Request, _res: Response, next: NextFunction): void {
	if (isObservabilityEnabled()) {
		const trace = currentTraceOf(_req);
		if (trace !== undefined) {
			trace.marks.body_parsed ??= performance.now();
		}
	}
	next();
}

/** 响应对象上暂存轨迹的字段名。 */
const TRACE_SYMBOL = Symbol("observability.trace");

/**
 * 从请求对象上取回轨迹；不依赖 AsyncLocalStorage，供中间件自身使用。
 * @param req - Express 请求
 */
function currentTraceOf(req: Request): RequestTraceState | undefined {
	return (req as Request & { [TRACE_SYMBOL]?: RequestTraceState })[TRACE_SYMBOL];
}

/**
 * 观测中间件。
 * @param req - Express 请求
 * @param res - Express 响应
 * @param next - 下一个中间件
 */
export const httpMetricsMiddleware: RequestHandler = (req, res, next) => {
	if (!isObservabilityEnabled()) {
		next();
		return;
	}
	const route = classifyRoute(req.originalUrl ?? req.url);
	const trace = createRequestTrace(req.method, route);
	(req as Request & { [TRACE_SYMBOL]?: RequestTraceState })[TRACE_SYMBOL] = trace;
	httpInFlight.add(1);
	runWithRequestTrace(trace, () => {
		instrumentResponse(res, trace);
		let recorded = false;
		const finish = (aborted: boolean): void => {
			if (recorded) {
				return;
			}
			recorded = true;
			try {
				recordRequest(req, res, trace, aborted);
			} catch (error) {
				logger.debug("请求指标记录失败", { error: error });
			}
		};
		res.on("finish", () => finish(false));
		res.on("close", () => {
			finish(!res.writableEnded);
		});
		next();
	});
};

/**
 * 判断一次写出的字节是否为流式协议前言（心跳、ping、填充）。
 *
 * 这些帧只能说明链路通了，不是模型输出。把它当首字节，会让首字指标变成链路建立
 * 时间，掩盖真实的生成延迟。
 * @param chunk - 写出的数据块
 */
export function isStreamPreamble(chunk: unknown): boolean {
	if (typeof chunk !== "string") {
		return false;
	}
	const head = chunk.slice(0, 64);
	if (head.startsWith(":")) {
		// SSE 注释行就是 keepalive
		return true;
	}
	if (head.startsWith("event: ping") || head.includes('"type":"ping"')) {
		return true;
	}
	return head.trim().length === 0;
}

/**
 * 包装写响应的方法：记录首个字节时刻、字节数与帧数。
 * @param res - Express 响应
 * @param trace - 请求轨迹
 */
function instrumentResponse(res: Response, trace: RequestTraceState): void {
	const target = res as Response & InstrumentedResponse;
	if (target[INSTRUMENTED] === true) {
		return;
	}
	target[INSTRUMENTED] = true;
	const writable = res as unknown as {
		write: (...args: unknown[]) => unknown;
		end: (...args: unknown[]) => unknown;
	};
	const originalWrite = writable.write.bind(res) as (...args: unknown[]) => unknown;
	writable.write = (...args: unknown[]): unknown => {
		const chunk = args[0];
		const now = performance.now();
		if (trace.marks.first_client_byte === undefined) {
			trace.marks.first_client_byte = now;
		}
		// 心跳、ping、填充帧是协议前言：它们在模型输出之前就到，不能算作首内容。
		if (!isStreamPreamble(chunk) && trace.marks.first_payload_byte === undefined) {
			trace.marks.first_payload_byte = now;
		}
		countChunk(trace, chunk);
		return originalWrite(...args);
	};
	const originalEnd = writable.end.bind(res) as (...args: unknown[]) => unknown;
	writable.end = (...args: unknown[]): unknown => {
		if (args.length > 0 && args[0] !== undefined) {
			countChunk(trace, args[0]);
		}
		if (trace.marks.first_client_byte === undefined) {
			trace.marks.first_client_byte = performance.now();
		}
		return originalEnd(...args);
	};
}

/**
 * 累计写出的字节数与帧数。
 * @param trace - 请求轨迹
 * @param chunk - 写出的分片
 */
function countChunk(trace: RequestTraceState, chunk: unknown): void {
	if (chunk === undefined || chunk === null) {
		return;
	}
	let size = 0;
	if (typeof chunk === "string") {
		size = Buffer.byteLength(chunk);
	} else if (Buffer.isBuffer(chunk)) {
		size = chunk.length;
	} else if (chunk instanceof Uint8Array) {
		size = chunk.byteLength;
	}
	trace.bytesOut += size;
	trace.chunksOut += 1;
}

/**
 * 从请求体补齐模型与流式标记；请求体可能极大，这里只读两个字段。
 * @param req - Express 请求
 */
function annotateFromBody(req: Request): void {
	const body: unknown = (req as { body?: unknown }).body;
	if (typeof body !== "object" || body === null) {
		return;
	}
	const record = body as Record<string, unknown>;
	const model = record["model"];
	if (typeof model === "string" && model.length > 0) {
		annotateRequestTrace({ requestedModel: model });
	}
	if (record["stream"] === true) {
		annotateRequestTrace({ stream: true });
	}
}

/**
 * 汇总并记录一次请求的全部指标。
 * @param req - Express 请求
 * @param res - Express 响应
 * @param trace - 请求轨迹
 * @param aborted - 客户端是否提前断开
 */
function recordRequest(req: Request, res: Response, trace: RequestTraceState, aborted: boolean): void {
	const endAt = performance.now();
	trace.statusCode = res.statusCode;
	trace.aborted = aborted;
	trace.marks.response_end ??= endAt;
	annotateFromBody(req);
	const breakdown = computeTimingBreakdown(trace, endAt);
	const labels = { route: trace.route, method: req.method };
	httpInFlight.add(-1);
	httpRequestsTotal.inc({ route: trace.route, method: req.method, status: String(res.statusCode) });
	httpRequestDuration.observe(breakdown.totalMs / 1000, labels);
	httpResponseBytes.observe(trace.bytesOut, { route: trace.route });
	const lastAttempt = trace.attempts[trace.attempts.length - 1];
	if (lastAttempt !== undefined || isInferenceRoute(trace.route)) {
		recordLlmMetrics(trace, breakdown, res.statusCode, aborted);
	}
	reportIfNoteworthy(req, trace, breakdown, res.statusCode, aborted, lastAttempt?.host);
}

/**
 * 记录推理维度的指标。
 * @param trace - 请求轨迹
 * @param breakdown - 耗时分解
 * @param statusCode - HTTP 状态码
 * @param aborted - 客户端是否提前断开
 */
function recordLlmMetrics(
	trace: RequestTraceState,
	breakdown: RequestTimingBreakdown,
	statusCode: number,
	aborted: boolean,
): void {
	const lastAttempt = trace.attempts[trace.attempts.length - 1];
	const firstAttempt = trace.attempts[0];
	const model = trace.requestedModel ?? "unknown";
	const provider = lastAttempt?.host ?? "unknown";
	const streamLabel = trace.stream ? "true" : "false";
	const failed = lastAttempt?.outcome === "error" || statusCode >= 400;
	const outcome = aborted ? "aborted" : failed ? "error" : "ok";
	llmRequestsTotal.inc({ model: model, provider: provider, stream: streamLabel, status: outcome });
	llmRequestDuration.observe(breakdown.totalMs / 1000, { model: model, stream: streamLabel });
	if (breakdown.firstByteMs !== undefined) {
		llmFirstByte.observe(breakdown.firstByteMs / 1000, { model: model, stream: streamLabel });
	}
	if (breakdown.ttfbMs !== undefined) {
		llmTtfb.observe(breakdown.ttfbMs / 1000, { model: model, stream: streamLabel });
	}
	if (breakdown.preUpstreamMs !== undefined) {
		llmPreUpstream.observe(breakdown.preUpstreamMs / 1000, { model: model });
	}
	llmPreUpstreamDbQueries.observe(trace.dbQueries);
	if (breakdown.upstreamHeadersMs !== undefined && firstAttempt !== undefined) {
		llmUpstreamHeaders.observe(breakdown.upstreamHeadersMs / 1000, { provider: firstAttempt.host });
	}
	if (breakdown.proxyOverheadMs !== undefined) {
		llmProxyOverhead.observe(breakdown.proxyOverheadMs / 1000, { model: model });
	}
	if (trace.stream && breakdown.streamMs !== undefined) {
		llmStreamDuration.observe(breakdown.streamMs / 1000, { model: model });
	}
	for (const attempt of trace.attempts) {
		llmUpstreamAttempts.inc({ provider: attempt.host, outcome: attempt.outcome });
	}
}

/**
 * 慢请求与失败请求的日志与环形缓冲记录。
 * @param req - Express 请求
 * @param trace - 请求轨迹
 * @param breakdown - 耗时分解
 * @param statusCode - HTTP 状态码
 * @param aborted - 客户端是否提前断开
 * @param provider - 上游主机
 */
function reportIfNoteworthy(
	req: Request,
	trace: RequestTraceState,
	breakdown: RequestTimingBreakdown,
	statusCode: number,
	aborted: boolean,
	provider: string | undefined,
): void {
	const isLlm = trace.attempts.length > 0 || isInferenceRoute(trace.route);
	const slow = isLlm
		? (breakdown.ttfbMs ?? 0) > SLOW_LLM_TTFB_MS || breakdown.totalMs > SLOW_LLM_TOTAL_MS
		: breakdown.totalMs > SLOW_REQUEST_MS;
	const failed = statusCode >= 500 && !aborted;
	const fields = {
		traceId: trace.id,
		method: req.method,
		route: trace.route,
		status: statusCode,
		model: trace.requestedModel,
		provider: provider,
		stream: trace.stream,
		aborted: aborted,
		bytesOut: trace.bytesOut,
		frames: trace.chunksOut,
		attempts: trace.attempts.length,
		dbQueries: trace.dbQueries,
		totalMs: breakdown.totalMs,
		ttfbMs: breakdown.ttfbMs,
		preUpstreamMs: breakdown.preUpstreamMs,
		upstreamHeadersMs: breakdown.upstreamHeadersMs,
		proxyOverheadMs: breakdown.proxyOverheadMs,
		streamMs: breakdown.streamMs,
	};
	if (slow || failed) {
		recordSlowRequest({
			at: new Date().toISOString(),
			trace_id: trace.id,
			method: req.method,
			route: trace.route,
			status: statusCode,
			model: trace.requestedModel,
			provider: provider,
			stream: trace.stream,
			aborted: aborted,
			total_ms: breakdown.totalMs,
			first_byte_ms: breakdown.firstByteMs,
			ttfb_ms: breakdown.ttfbMs,
			pre_upstream_ms: breakdown.preUpstreamMs,
			upstream_headers_ms: breakdown.upstreamHeadersMs,
			proxy_overhead_ms: breakdown.proxyOverheadMs,
			stream_ms: breakdown.streamMs,
			bytes_out: trace.bytesOut,
			db_queries: trace.dbQueries,
		});
	}
	if (slow) {
		logger.warn("慢请求", fields);
		return;
	}
	if (failed && isLlm) {
		logger.error("推理请求失败", fields);
		return;
	}
	if (logger.isLevelEnabled("debug")) {
		logger.debug("请求耗时", fields);
	}
}
