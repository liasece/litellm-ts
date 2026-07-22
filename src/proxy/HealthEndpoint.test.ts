/**
 * Health 端点契约测试
 *
 * 锁定与 Python LiteLLM health_endpoints 对齐的响应结构：
 * - /health: { healthy_endpoints, unhealthy_endpoints, healthy_count, unhealthy_count }
 * - /health/services: 缺 service 参数返回 422 FastAPI 风格 { detail: [...] }，
 *   非法 service 返回 400 Python ProxyException 风格错误
 * 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/health_endpoints/_health_endpoints.py
 */
import express from "express";
import request from "supertest";
import { registerController } from "../core/api/registerController";
import { HealthController } from "./HealthEndpoint";
import { DeploymentNotFoundError, type DeploymentProbeResult, type Router } from "../router/Router";

function buildApp(router?: Pick<Router, "getDeployments" | "probeDeployment">, requireAuth = false): express.Express {
	const app = express();
	app.use(express.json());
	registerController(app, new HealthController(router as Router | undefined), {
		requireAuth: requireAuth
			? (req, res, next) => {
					if (req.header("authorization") !== "Bearer test") {
						res.status(401).json({ error: "unauthorized" });
						return;
					}
					next();
				}
			: undefined,
	});
	return app;
}

function probeResult(modelId: string, status: "healthy" | "unhealthy"): DeploymentProbeResult {
	return {
		model_id: modelId,
		model_name: "group",
		status: status,
		checked_at: "2026-07-22T00:00:00.000Z",
		latency_ms: 12,
		...(status === "unhealthy" ? { error: "Provider returned HTTP 401" } : {}),
	};
}

describe("Health 端点契约", () => {
	describe("/health", () => {
		it("应返回 healthy/unhealthy 四字段结构（无健康检查结果时为空态）", async () => {
			const app = buildApp();
			const res = await request(app).get("/health");
			expect(res.status).toBe(200);
			expect(Array.isArray(res.body.healthy_endpoints)).toBe(true);
			expect(Array.isArray(res.body.unhealthy_endpoints)).toBe(true);
			expect(typeof res.body.healthy_count).toBe("number");
			expect(typeof res.body.unhealthy_count).toBe("number");
			expect(res.body.healthy_count).toBe(res.body.healthy_endpoints.length);
			expect(res.body.unhealthy_count).toBe(res.body.unhealthy_endpoints.length);
		});

		it("按 model_id 精确探测并覆盖 latest snapshot", async () => {
			const probeDeployment = jest
				.fn()
				.mockResolvedValueOnce(probeResult("deployment-1", "healthy"))
				.mockResolvedValueOnce(probeResult("deployment-1", "unhealthy"));
			const app = buildApp({ getDeployments: jest.fn().mockReturnValue([]), probeDeployment: probeDeployment });

			await request(app)
				.get("/health?model_id=deployment-1")
				.expect(200)
				.expect({
					healthy_endpoints: [probeResult("deployment-1", "healthy")],
					unhealthy_endpoints: [],
					healthy_count: 1,
					unhealthy_count: 0,
				});
			await request(app).get("/health?model_id=deployment-1").expect(200);
			const latest = await request(app).get("/health/latest").expect(200);
			expect(latest.body.total_models).toBe(1);
			expect(latest.body.latest_health_checks["deployment-1"]).toMatchObject({
				status: "unhealthy",
				error_message: "Provider returned HTTP 401",
			});
		});

		it("无参 /health 覆盖全部 deployment、按最多 5 个并发探测并写入 latest snapshot", async () => {
			const deployments = Array.from({ length: 7 }, (_, index) => ({ model_info: { id: `deployment-${index}` } }));
			let active = 0;
			let peak = 0;
			const probeDeployment = jest.fn(async (id: string) => {
				active += 1;
				peak = Math.max(peak, active);
				await new Promise((resolve) => setTimeout(resolve, 5));
				active -= 1;
				return probeResult(id, Number(id.split("-")[1]) % 2 === 0 ? "healthy" : "unhealthy");
			});
			const app = buildApp({ getDeployments: jest.fn().mockReturnValue(deployments), probeDeployment: probeDeployment });

			const response = await request(app).get("/health").expect(200);
			expect(probeDeployment).toHaveBeenCalledTimes(7);
			expect(peak).toBeLessThanOrEqual(5);
			expect(response.body.healthy_count).toBe(4);
			expect(response.body.unhealthy_count).toBe(3);
			const latest = await request(app).get("/health/latest").expect(200);
			expect(latest.body.total_models).toBe(7);
			expect(latest.body.latest_health_checks["deployment-0"].status).toBe("healthy");
			expect(latest.body.latest_health_checks["deployment-1"].status).toBe("unhealthy");
		});

		it("未知 model_id 返回 404", async () => {
			const app = buildApp({
				getDeployments: jest.fn().mockReturnValue([]),
				probeDeployment: jest.fn().mockRejectedValue(new DeploymentNotFoundError("missing")),
			});
			await request(app).get("/health?model_id=missing").expect(404);
		});

		it("仅 /health 与 /health/latest 需要认证，liveliness 保持公开", async () => {
			const app = buildApp(undefined, true);
			await request(app).get("/health").expect(401);
			await request(app).get("/health/latest").expect(401);
			await request(app).get("/health/liveliness").expect(200);
		});
	});

	describe("/health/services", () => {
		it("缺 service 参数应返回 422 FastAPI 风格 { detail: [{ loc, msg, type }] }", async () => {
			const app = buildApp();
			const res = await request(app).get("/health/services");
			expect(res.status).toBe(422);
			expect(Array.isArray(res.body.detail)).toBe(true);
			expect(res.body.detail[0]).toMatchObject({
				loc: ["query", "service"],
				msg: "Field required",
				type: "missing",
			});
		});

		it("非法 service 应返回 400 auth_error（对齐 Python 实测响应）", async () => {
			const app = buildApp();
			const res = await request(app).get("/health/services?service=postgres");
			expect(res.status).toBe(400);
			expect(res.body.error).toMatchObject({
				type: "auth_error",
				param: "None",
				code: "400",
			});
			expect(res.body.error.message).toContain("Service must be in list. Service=postgres not in typing.Union");
		});

		it("合法 service 应返回 { status, message } 成功形状", async () => {
			const app = buildApp();
			const res = await request(app).get("/health/services?service=datadog");
			expect(res.status).toBe(200);
			expect(res.body).toEqual({
				status: "success",
				message: "Mock LLM request made - check datadog.",
			});
		});
	});

	describe("/health/liveliness", () => {
		it("应返回存活字符串", async () => {
			const app = buildApp();
			const res = await request(app).get("/health/liveliness");
			expect(res.status).toBe(200);
			expect(res.text).toContain("I'm alive!");
		});
	});
});
