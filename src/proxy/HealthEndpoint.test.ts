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
import { Database } from "../core/db/Database";
import { HealthController, type ReadinessDatabase } from "./HealthEndpoint";
import { DeploymentNotFoundError, type DeploymentProbeResult, type Router } from "../router/Router";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const mockPoolQuery = jest.fn();
const mockPoolEnd = jest.fn();
const mockClientRelease = jest.fn();
const mockClientQuery = jest.fn().mockImplementation((query: unknown) => {
	const text = typeof query === "string" ? query : "";
	if (text.includes("current_schema() AS schema_name")) {
		return Promise.resolve({ rows: [{ schema_name: "public" }] });
	}
	return Promise.resolve(text.includes("count(*)") ? { rows: [{ table_count: "0" }] } : { rows: [] });
});
const mockPoolConnect = jest.fn().mockResolvedValue({ query: mockClientQuery, release: mockClientRelease });

jest.mock("pg", () => ({
	__esModule: true,
	default: {
		Pool: jest.fn().mockImplementation(() => ({ connect: mockPoolConnect, query: mockPoolQuery, end: mockPoolEnd })),
	},
}));

jest.mock("drizzle-orm/node-postgres/migrator", () => ({ migrate: jest.fn() }));
jest.mock("../core/db/SchemaPreflight", () => ({ runSchemaPreflight: jest.fn().mockResolvedValue(undefined) }));

function buildApp(
	router?: Pick<Router, "getDeployments" | "probeDeployment">,
	requireAuth = false,
	database?: ReadinessDatabase,
): express.Express {
	const app = express();
	app.use(express.json());
	registerController(app, new HealthController(router as Router | undefined, database), {
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

	describe("/health/readiness", () => {
		const loadedRouter = {
			getDeployments: jest.fn().mockReturnValue([{ model_info: { id: "deployment-1" } }]),
			probeDeployment: jest.fn(),
		};

		it("DB 可用且 Router 已加载 deployment 时返回 healthy", async () => {
			const database: ReadinessDatabase = { probeReadiness: jest.fn().mockResolvedValue({ ready: true }) };
			const res = await request(buildApp(loadedRouter, false, database)).get("/health/readiness");
			expect(res.status).toBe(200);
			expect(res.body).toMatchObject({ status: "healthy", db: "connected" });
		});

		it("DB probe 失败时返回脱敏 503", async () => {
			const database: ReadinessDatabase = {
				probeReadiness: jest.fn().mockResolvedValue({ ready: false, reason: "query_failed" }),
			};
			const res = await request(buildApp(loadedRouter, false, database)).get("/health/readiness");
			expect(res.status).toBe(503);
			expect(res.body.error).toMatchObject({ message: "Service is not ready", type: "service_unavailable", code: "503" });
			expect(JSON.stringify(res.body)).not.toContain("query_failed");
		});

		it("DB probe 抛出连接详情时仍返回脱敏 503", async () => {
			const database: ReadinessDatabase = {
				probeReadiness: jest.fn().mockRejectedValue(new Error("password=secret host=internal-db")),
			};
			const res = await request(buildApp(loadedRouter, false, database)).get("/health/readiness");
			expect(res.status).toBe(503);
			expect(JSON.stringify(res.body)).not.toContain("secret");
			expect(JSON.stringify(res.body)).not.toContain("internal-db");
		});

		it("Router 尚无 deployment 时返回脱敏 503", async () => {
			const database: ReadinessDatabase = { probeReadiness: jest.fn().mockResolvedValue({ ready: true }) };
			const router = { getDeployments: jest.fn().mockReturnValue([]), probeDeployment: jest.fn() };
			const res = await request(buildApp(router, false, database)).get("/health/readiness");
			expect(res.status).toBe(503);
			expect(res.body.error.message).toBe("Service is not ready");
		});
	});

	describe("/health/liveliness", () => {
		it("DB 失败时两个存活端点仍返回 200", async () => {
			const database: ReadinessDatabase = {
				probeReadiness: jest.fn().mockRejectedValue(new Error("database unavailable")),
			};
			const app = buildApp(undefined, false, database);
			await request(app).get("/health/liveliness").expect(200, '"I\'m alive!"');
			await request(app).get("/health/liveness").expect(200, '"I\'m alive!"');
			expect(database.probeReadiness).not.toHaveBeenCalled();
		});
	});
});

describe("Database readiness probe", () => {
	const config = { host: "db.internal", port: 5432, database: "litellm", user: "user", password: "secret" };
	const mockedMigrate = jest.mocked(migrate);

	beforeEach(() => {
		jest.clearAllMocks();
		mockedMigrate.mockResolvedValue(undefined);
		mockPoolQuery.mockResolvedValue({ rows: [{ "?column?": 1 }] });
	});

	it("initialize 完成前返回结构化未就绪且不查询", async () => {
		const database = new Database(config);
		await expect(database.probeReadiness()).resolves.toEqual({ ready: false, reason: "not_initialized" });
		expect(mockPoolQuery).not.toHaveBeenCalled();
	});

	it("initialize 完成后执行 SELECT 1 并返回 ready", async () => {
		const database = new Database(config);
		await database.initialize();
		await expect(database.probeReadiness()).resolves.toEqual({ ready: true });
		expect(mockPoolQuery).toHaveBeenCalledWith("SELECT 1");
	});

	it("后续 initialize 失败时清除已完成状态", async () => {
		const database = new Database(config);
		await database.initialize();
		mockedMigrate.mockRejectedValue(new Error("migration failed"));
		await expect(database.initialize()).rejects.toThrow("migration failed");
		await expect(database.probeReadiness()).resolves.toEqual({ ready: false, reason: "not_initialized" });
		expect(mockPoolQuery).not.toHaveBeenCalled();
	});

	it("SELECT 1 异常转为不含连接信息的结构化失败", async () => {
		const database = new Database(config);
		await database.initialize();
		mockPoolQuery.mockRejectedValue(new Error("password=secret host=db.internal"));
		const result = await database.probeReadiness();
		expect(result).toEqual({ ready: false, reason: "query_failed" });
		expect(JSON.stringify(result)).not.toContain("secret");
		expect(JSON.stringify(result)).not.toContain("db.internal");
	});
});
