/**
 * HealthEndpoint E2E 集成测试
 *
 * 启动真实 Express 实例，验证所有健康检查端点。
 */
import express from "express";
import request from "supertest";
import { registerController } from "../../src/core/api/registerController";
import { HealthController, type ReadinessDatabase } from "../../src/proxy/HealthEndpoint";
import type { Router } from "../../src/router/Router";

describe("Health Endpoints E2E", () => {
	let app: express.Express;

	beforeAll(() => {
		app = express();
		app.use(express.json());
		const router = {
			getDeployments: () => [{ model_info: { id: "deployment-1" } }],
			probeDeployment: async () => ({
				model_id: "deployment-1",
				model_name: "gpt-4",
				status: "healthy" as const,
				checked_at: "2026-07-22T00:00:00.000Z",
				latency_ms: 8,
			}),
		} as unknown as Router;
		const database: ReadinessDatabase = { probeReadiness: async () => ({ ready: true }) };
		registerController(app, new HealthController(router, database), {
			requireAuth: (req, res, next) => {
				if (req.header("authorization") !== "Bearer test") {
					res.status(401).json({ error: "unauthorized" });
					return;
				}
				next();
			},
		});
	});

	it("GET /health requires auth and probes the requested deployment", async () => {
		await request(app).get("/health?model_id=deployment-1").expect(401);
		const res = await request(app).get("/health?model_id=deployment-1").set("authorization", "Bearer test");
		expect(res.status).toBe(200);
		expect(res.body.healthy_count).toBe(1);
		expect(res.body.unhealthy_count).toBe(0);
		expect(res.body.healthy_endpoints[0]).toMatchObject({ model_id: "deployment-1", status: "healthy" });
	});

	it("GET /health/readiness returns 200 ready", async () => {
		const res = await request(app).get("/health/readiness");
		expect(res.status).toBe(200);
		expect(res.body.status).toBe("healthy");
		expect(res.body.db).toBe("connected");
		expect(res.body.latest_health_checks).toBeUndefined();
	});

	it("GET /health/liveliness returns 200 alive", async () => {
		const res = await request(app).get("/health/liveliness");
		expect(res.status).toBe(200);
		expect(res.body).toBe("I'm alive!");
	});

	it("GET /health/liveness returns 200 alive", async () => {
		const res = await request(app).get("/health/liveness");
		expect(res.status).toBe(200);
		expect(res.body).toBe("I'm alive!");
	});

	it("GET /health/services without service returns 422 FastAPI style", async () => {
		const res = await request(app).get("/health/services");
		expect(res.status).toBe(422);
		expect(Array.isArray(res.body.detail)).toBe(true);
		expect(res.body.detail[0]).toMatchObject({ loc: ["query", "service"], msg: "Field required", type: "missing" });
	});

	it("GET /health/services with valid service returns success shape", async () => {
		const res = await request(app).get("/health/services?service=langfuse");
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ status: "success", message: "Mock LLM request made - check langfuse." });
	});
	it("GET /health/latest requires auth and reads the in-memory snapshot without probing", async () => {
		await request(app).get("/health/latest").expect(401);
		const res = await request(app).get("/health/latest").set("authorization", "Bearer test");
		expect(res.status).toBe(200);
		expect(res.body.total_models).toBe(1);
		expect(res.body.latest_health_checks["deployment-1"]).toMatchObject({ status: "healthy", latency_ms: 8 });
	});
});
