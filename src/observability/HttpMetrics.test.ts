import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
	httpMetricsMiddleware,
	isStreamPreamble,
	markBodyParsed,
	OBSERVABILITY_ENABLED_ENV,
	setObservabilityEnabledForTests,
} from "./HttpMetrics";
import {
	httpInFlight,
	httpRequestsTotal,
	httpResponseBytes,
	llmFirstByte,
	llmProxyOverhead,
	llmRequestsTotal,
	llmTtfb,
} from "./MetricCatalog";
import { recentSlowRequests, resetSlowRequests } from "./SlowRequestLog";
import { beginUpstreamAttempt, endUpstreamAttempt, noteUpstreamFirstChunk, noteUpstreamHeaders } from "./RequestTrace";

/** 测试用上游地址，主机名会作为 provider 标签。 */
const UPSTREAM_URL = "https://api.deepseek.com/v1/chat/completions";

/** 测试模型名。 */
const MODEL = "deepseek-v4.1-flash";

/**
 * 等待条件成立，用于等待响应结束后的异步收尾。
 * @param predicate - 判定函数
 */
async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("等待条件超时");
}

/**
 * 启动带观测中间件的测试服务。
 */
async function startServer(): Promise<Server> {
	const app = express();
	app.use(httpMetricsMiddleware);
	app.use(express.json());
	app.use(markBodyParsed);
	app.post("/v1/chat/completions", async (req, res) => {
		const attempt = beginUpstreamAttempt(UPSTREAM_URL);
		// 模拟上游首包延迟：首字节耗时应当把这 30ms 算进去。
		await new Promise((resolve) => setTimeout(resolve, 30));
		noteUpstreamHeaders(attempt, 200);
		noteUpstreamFirstChunk();
		endUpstreamAttempt(attempt, "ok");
		res.setHeader("content-type", "text/event-stream");
		res.write('data: {"delta":"a"}\n\n');
		res.write("data: [DONE]\n\n");
		res.end();
		void req.body;
	});
	app.post("/responses", async (req, res) => {
		const attempt = beginUpstreamAttempt("http://127.0.0.1:8317/v1/responses");
		noteUpstreamHeaders(attempt, 200);
		endUpstreamAttempt(attempt, "ok");
		res.setHeader("content-type", "text/event-stream");
		res.flushHeaders();
		// 协议前言：先到 4KB 填充 ping，代表「链路已经通了」，但它不是模型输出。
		res.write(`event: ping\ndata: ${JSON.stringify({ type: "ping", padding: " ".repeat(64) })}\n\n`);
		await new Promise((resolve) => setTimeout(resolve, 60));
		res.write('event: response.output_text.delta\ndata: {"delta":"hi"}\n\n');
		res.end();
		void req.body;
	});
	app.post("/v1/messages", async (req, res) => {
		const attempt = beginUpstreamAttempt("http://127.0.0.1:8317/v1/messages");
		res.setHeader("content-type", "text/event-stream");
		res.flushHeaders();
		// 本地合成的前言先到客户端，模型 80ms 后才开始产出，内容 160ms 才写出。
		res.write('event: ping\ndata: {"type":"ping"}\n\n');
		await new Promise((resolve) => setTimeout(resolve, 80));
		noteUpstreamHeaders(attempt, 200);
		noteUpstreamFirstChunk();
		await new Promise((resolve) => setTimeout(resolve, 80));
		res.write('event: content_block_delta\ndata: {"delta":{"text":"hi"}}\n\n');
		res.end();
		void req.body;
	});
	app.get("/boom", (_req, res) => {
		res.status(500).json({ error: "upstream failed" });
	});
	app.get("/quick", (_req, res) => {
		res.json({ ok: true });
	});
	return new Promise<Server>((resolve, reject) => {
		const server = app.listen(0, "127.0.0.1", () => resolve(server));
		server.once("error", reject);
	});
}

/**
 * 发起请求并读完响应。
 * @param port - 端口
 * @param method - 方法
 * @param path - 路径
 * @param body - 请求体
 */
function request(
	port: number,
	method: string,
	path: string,
	body?: unknown,
): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
		const req = http.request(
			{
				hostname: "127.0.0.1",
				port: port,
				path: path,
				method: method,
				headers:
					payload === undefined
						? {}
						: { "content-type": "application/json", "content-length": String(payload.length) },
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", () =>
					resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
				);
			},
		);
		req.once("error", reject);
		req.end(payload);
	});
}

describe("httpMetricsMiddleware", () => {
	let server: Server;
	let port: number;

	beforeAll(async () => {
		server = await startServer();
		port = (server.address() as AddressInfo).port;
	});

	afterAll(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	beforeEach(() => {
		resetSlowRequests();
	});

	it("流式请求记录状态、模型、上游 provider 与首字节耗时", async () => {
		const result = await request(port, "POST", "/v1/chat/completions", { model: MODEL, stream: true });
		expect(result.status).toBe(200);
		expect(result.body).toContain("[DONE]");
		await waitFor(() => httpInFlight.value() === 0);

		expect(httpRequestsTotal.windowValue({ route: "/v1/chat/completions", method: "POST", status: "200" })).toBe(1);
		expect(
			llmRequestsTotal.windowValue({
				model: MODEL,
				provider: "api.deepseek.com",
				stream: "true",
				status: "ok",
			}),
		).toBe(1);
		// 上游首包延迟 30ms，首字节耗时不可能低于 20ms。
		const ttfbMs = (llmTtfb.quantile(0.5) ?? 0) * 1000;
		expect(ttfbMs).toBeGreaterThanOrEqual(20);
		// 两帧 SSE 都被计入写出字节，且没有把请求算作慢请求。
		expect(httpResponseBytes.windowSnapshot().some((item) => item.sum > 0)).toBe(true);
		expect(recentSlowRequests()).toHaveLength(0);
	});

	it("协议前言（ping/填充）到达早，但不计入首内容耗时", async () => {
		await request(port, "POST", "/responses", { model: "preamble-model", stream: true });
		await waitFor(() => httpInFlight.value() === 0);
		const byModel = (labels: Record<string, string>): boolean => labels["model"] === "preamble-model";
		// 传输首字节几乎是立即到达的，真实内容在 60ms 后才写出。
		const firstByteMs = (llmFirstByte.quantile(0.5, undefined, byModel) ?? 0) * 1000;
		const contentMs = (llmTtfb.quantile(0.5, undefined, byModel) ?? 0) * 1000;
		expect(firstByteMs).toBeLessThan(50);
		expect(contentMs).toBeGreaterThanOrEqual(50);
	});

	it("首字以模型开始产出为准，本地前言只计入传输首字节", async () => {
		await request(port, "POST", "/v1/messages", { model: "messages-model", stream: true });
		await waitFor(() => httpInFlight.value() === 0);
		const byModel = (labels: Record<string, string>): boolean => labels["model"] === "messages-model";
		const firstByteMs = (llmFirstByte.quantile(0.5, undefined, byModel) ?? 0) * 1000;
		const ttfbMs = (llmTtfb.quantile(0.5, undefined, byModel) ?? 0) * 1000;
		const overheadMs = (llmProxyOverhead.quantile(0.5, undefined, byModel) ?? 0) * 1000;
		// 前言几乎立即写出，模型 80ms 开始，内容 160ms 到达；分位按桶插值，因此用桶宽量级判定。
		expect(firstByteMs).toBeLessThan(50);
		expect(ttfbMs).toBeGreaterThanOrEqual(60);
		expect(ttfbMs).toBeLessThan(110);
		expect(overheadMs).toBeGreaterThanOrEqual(50);
	});

	it("前言判定覆盖心跳、ping 与空写，不影响普通数据帧", () => {
		expect(isStreamPreamble(": keepalive\n\n")).toBe(true);
		expect(isStreamPreamble('event: ping\ndata: {"type":"ping"}\n\n')).toBe(true);
		expect(isStreamPreamble('data: {"type":"ping"}\n\n')).toBe(true);
		expect(isStreamPreamble("   ")).toBe(true);
		expect(isStreamPreamble('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n')).toBe(false);
		expect(isStreamPreamble(Buffer.from("data: x\n\n"))).toBe(false);
	});

	it("普通请求按路由归一化计数，5xx 进入慢请求明细", async () => {
		await request(port, "GET", "/quick?trace=1");
		await request(port, "GET", "/boom");
		await waitFor(() => httpInFlight.value() === 0);
		expect(httpRequestsTotal.windowValue({ route: "/quick", method: "GET", status: "200" })).toBe(1);
		const records = recentSlowRequests();
		expect(records).toHaveLength(1);
		expect(records[0]?.route).toBe("/boom");
		expect(records[0]?.status).toBe(500);
	});

	it("关闭开关后不再采集任何指标", async () => {
		setObservabilityEnabledForTests(false);
		try {
			const before = httpRequestsTotal.sumWhere();
			await request(port, "GET", "/quick");
			expect(httpRequestsTotal.sumWhere()).toBe(before);
		} finally {
			setObservabilityEnabledForTests(null);
			expect(process.env[OBSERVABILITY_ENABLED_ENV]).not.toBe("false");
		}
	});
});
