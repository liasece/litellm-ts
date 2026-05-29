/**
 * HealthEndpoint E2E 集成测试
 *
 * 启动真实 Express 实例，验证所有健康检查端点。
 */
import express from "express";
import request from "supertest";
import { registerController } from "../../src/core/api/registerController";
import { HealthController } from "../../src/proxy/HealthEndpoint";

describe("Health Endpoints E2E", () => {
	let app: express.Express;

	beforeAll(() => {
		app = express();
		app.use(express.json());
		registerController(app, new HealthController());
	});

	it("GET /health returns 200 ok", async () => {
		const res = await request(app).get("/health");
		expect(res.status).toBe(200);
		expect(res.body.status).toBe("ok");
	});

	it("GET /health/readiness returns 200 ready", async () => {
		const res = await request(app).get("/health/readiness");
		expect(res.status).toBe(200);
		expect(res.body.status).toBe("ready");
	});

	it("GET /health/liveliness returns 200 alive", async () => {
		const res = await request(app).get("/health/liveliness");
		expect(res.status).toBe(200);
		expect(res.body.status).toBe("alive");
	});

	it("GET /health/liveness returns 200 alive", async () => {
		const res = await request(app).get("/health/liveness");
		expect(res.status).toBe(200);
		expect(res.body.status).toBe("alive");
	});

	it("GET /health/services returns service status", async () => {
		const res = await request(app).get("/health/services");
		expect(res.status).toBe(200);
		expect(res.body.status).toBe("ok");
		expect(res.body.services).toBeDefined();
	});
});
