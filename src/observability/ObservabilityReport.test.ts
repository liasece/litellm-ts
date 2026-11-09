import {
	httpRequestDuration,
	httpRequestsTotal,
	llmRequestDuration,
	llmRequestsTotal,
	llmTtfb,
	llmTokensTotal,
} from "./MetricCatalog";
import { buildObservabilitySummary } from "./ObservabilityReport";
import { recordSlowRequest, resetSlowRequests } from "./SlowRequestLog";

describe("buildObservabilitySummary", () => {
	beforeEach(() => {
		resetSlowRequests();
	});

	it("按路由的窗口分位数落在真实桶区间，不随最高桶漂移", () => {
		for (let index = 0; index < 90; index += 1) {
			httpRequestsTotal.inc({ route: "/report/fast", method: "GET", status: "200" }, 1);
			httpRequestDuration.observe(0.02, { route: "/report/fast", method: "GET" });
		}
		for (let index = 0; index < 10; index += 1) {
			httpRequestsTotal.inc({ route: "/report/fast", method: "GET", status: "200" }, 1);
			httpRequestDuration.observe(0.3, { route: "/report/fast", method: "GET" });
		}
		const row = buildObservabilitySummary(60).http.by_route.find((item) => item.route === "/report/fast");
		expect(row?.requests).toBe(100);
		expect(row?.p50_ms).toBeLessThanOrEqual(50);
		expect(row?.p95_ms).toBeLessThanOrEqual(500);
		expect(row?.p95_ms).toBeGreaterThan(100);
	});

	it("把请求、模型维度与阶段耗时汇总成可直接读的窗口报表", () => {
		httpRequestsTotal.inc({ route: "/report/demo", method: "POST", status: "200" }, 2);
		httpRequestsTotal.inc({ route: "/report/demo", method: "POST", status: "502" }, 1);
		httpRequestDuration.observe(0.4, { route: "/report/demo", method: "POST" });
		httpRequestDuration.observe(1.2, { route: "/report/demo", method: "POST" });
		llmRequestsTotal.inc({ model: "report-model", provider: "api.example.com", stream: "true", status: "ok" }, 1);
		llmTtfb.observe(0.35, { model: "report-model", stream: "true" });
		llmRequestDuration.observe(4.5, { model: "report-model", stream: "true" });
		llmTokensTotal.inc({ model: "report-model", kind: "completion" }, 600);

		const summary = buildObservabilitySummary(60);
		expect(summary.window_seconds).toBe(60);
		const route = summary.http.by_route.find((item) => item.route === "/report/demo");
		expect(route?.requests).toBe(2);
		expect(route?.p95_ms).toBeGreaterThanOrEqual(400);
		expect(summary.http.by_status.some((item) => item.status === "502" && item.count === 1)).toBe(true);
		const model = summary.llm.by_model.find((item) => item.model === "report-model");
		expect(model?.stream).toBe(true);
		expect(model?.requests).toBe(1);
		expect(summary.llm.requests).toBe(1);
		expect(summary.llm.ttfb_ms.count).toBeGreaterThanOrEqual(1);
		expect(summary.llm.duration_ms.p95_ms).toBeGreaterThanOrEqual(4_000);
		expect(summary.llm.tokens.completion).toBeGreaterThanOrEqual(600);
		expect(summary.process.memory_bytes.rss).toBeGreaterThan(0);
		expect(summary.db.pool.total).toBe(0);
	});

	it("慢请求明细按最新在前输出，并限制返回条数", () => {
		for (let index = 0; index < 3; index += 1) {
			recordSlowRequest({
				at: new Date(1_700_000_000_000 + index * 1000).toISOString(),
				trace_id: `trace-${index}`,
				method: "POST",
				route: "/v1/messages",
				status: 200,
				stream: true,
				aborted: false,
				total_ms: 130_000 + index,
				bytes_out: 1024,
				db_queries: 6,
			});
		}
		const summary = buildObservabilitySummary();
		expect(summary.top_slow).toHaveLength(3);
		expect(summary.top_slow[0]?.trace_id).toBe("trace-2");
	});
});
