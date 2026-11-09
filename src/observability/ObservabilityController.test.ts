import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Server } from "node:http";
import { httpMetricsMiddleware, markBodyParsed, setObservabilityEnabledForTests } from "./HttpMetrics";
import { registerObservabilityRoutes } from "./ObservabilityController";
import { resetSlowRequests } from "./SlowRequestLog";
import { beginUpstreamAttempt, endUpstreamAttempt, noteUpstreamHeaders } from "./RequestTrace";

/** 测试用认证中间件：模拟真实的中断式鉴权（失败时不调用 next）。 */
const requireKey: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
	if (req.headers["x-test-key"] !== "secret") {
		res.status(401).json({ error: { message: "unauthorized" } });
		return;
	}
	next();
};

/**
 * 启动带观测端点的测试服务。
 */
async function startServer(): Promise<Server> {
	const app = express();
	app.use(httpMetricsMiddleware);
	app.use(express.json());
	app.use(markBodyParsed);
	const router = express.Router();
	registerObservabilityRoutes(router, requireKey);
	app.use(router);
	app.post("/v1/chat/completions", (req, res) => {
		const attempt = beginUpstreamAttempt("https://api.example.com/v1/chat/completions");
		noteUpstreamHeaders(attempt, 200);
		endUpstreamAttempt(attempt, "ok");
		res.setHeader("content-type", "text/event-stream");
		res.write('data: {"delta":"a"}\n\n');
		res.end();
		void req.body;
	});
	return new Promise<Server>((resolve, reject) => {
		const server = app.listen(0, "127.0.0.1", () => resolve(server));
		server.once("error", reject);
	});
}

/**
 * 发起请求。
 * @param port - 端口
 * @param method - 方法
 * @param path - 路径
 * @param headers - 请求头
 * @param body - 请求体
 */
function request(
	port: number,
	method: string,
	path: string,
	headers: Record<string, string> = {},
	body?: unknown,
): Promise<{ status: number; contentType: string; body: string }> {
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
						? headers
						: { ...headers, "content-type": "application/json", "content-length": String(payload.length) },
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", () =>
					resolve({
						status: response.statusCode ?? 0,
						contentType: String(response.headers["content-type"] ?? ""),
						body: Buffer.concat(chunks).toString("utf8"),
					}),
				);
			},
		);
		req.once("error", reject);
		req.end(payload);
	});
}

describe("观测端点", () => {
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

	it("未认证访问被拒绝，告警不被指标端点的存在绕过", async () => {
		const result = await request(port, "GET", "/metrics");
		expect(result.status).toBe(401);
	});

	it("Prometheus 端点输出文本格式并包含真实请求计数", async () => {
		await request(port, "POST", "/v1/chat/completions", { "x-test-key": "secret" }, { model: "demo-model" });
		await new Promise((resolve) => setTimeout(resolve, 50));
		const result = await request(port, "GET", "/metrics", { "x-test-key": "secret" });
		expect(result.status).toBe(200);
		expect(result.contentType).toContain("text/plain");
		expect(result.body).toContain("# TYPE litellm_http_requests_total counter");
		expect(result.body).toContain('litellm_http_requests_total{route="/v1/chat/completions",method="POST",status="200"}');
		expect(result.body).toContain("# TYPE litellm_process_uptime_seconds gauge");
		expect(result.body.trimEnd().endsWith("# EOF")).toBe(true);
	});

	it("概览端点返回窗口报表，包含推理与进程分段", async () => {
		await request(port, "POST", "/v1/chat/completions", { "x-test-key": "secret" }, { model: "summary-model", stream: true });
		await new Promise((resolve) => setTimeout(resolve, 50));
		const result = await request(port, "GET", "/metrics/summary?window=60", { "x-test-key": "secret" });
		expect(result.status).toBe(200);
		const summary = JSON.parse(result.body) as {
			window_seconds: number;
			llm: { by_model: Array<{ model: string }>; pre_upstream_db_queries: { count: number } };
			http: { requests: number };
			process: { memory_bytes: { rss: number } };
		};
		expect(summary.window_seconds).toBe(60);
		expect(summary.llm.by_model.some((row) => row.model === "demo-model" || row.model === "summary-model")).toBe(true);
		expect(summary.llm.pre_upstream_db_queries.count).toBeGreaterThanOrEqual(1);
		expect(summary.process.memory_bytes.rss).toBeGreaterThan(0);
	});

	it("慢请求端点在没有异常时返回空列表", async () => {
		const result = await request(port, "GET", "/metrics/slow", { "x-test-key": "secret" });
		expect(result.status).toBe(200);
		expect(JSON.parse(result.body)).toEqual({ requests: [] });
	});

	it("开关关闭后端点返回 404，不再对外暴露", async () => {
		setObservabilityEnabledForTests(false);
		try {
			const result = await request(port, "GET", "/metrics", { "x-test-key": "secret" });
			expect(result.status).toBe(404);
		} finally {
			setObservabilityEnabledForTests(null);
		}
	});
});
