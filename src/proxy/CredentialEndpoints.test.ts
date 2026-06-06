/**
 * Credential 端点契约测试
 *
 * 锁定 WebUI Credentials 页面使用的响应形状与错误码：
 * - 缺失 credential_name → 400
 * - 查询/删除不存在的凭据 → 404
 * - 创建成功 → { success: true }
 */
import express from "express";
import request from "supertest";
import { registerCredentialRoutes } from "./CredentialEndpoints";

function makeApp(): express.Express {
	const app = express();
	app.use(express.json());
	const router = express.Router();
	registerCredentialRoutes(router);
	app.use(router);
	return app;
}

describe("CredentialEndpoints", () => {
	describe("POST /credentials", () => {
		it("缺 credential_name 返回 400", async () => {
			const app = makeApp();
			const res = await request(app).post("/credentials").send({});
			expect(res.status).toBe(400);
		});

		it("创建成功返回 { success: true }", async () => {
			const app = makeApp();
			const res = await request(app).post("/credentials").send({ credential_name: "aws-1" });
			expect(res.status).toBe(200);
			expect(res.body).toEqual({ success: true });
		});
	});

	describe("GET /credentials/by_name/:name", () => {
		it("凭据不存在返回 404", async () => {
			const app = makeApp();
			const res = await request(app).get("/credentials/by_name/missing");
			expect(res.status).toBe(404);
		});

		it("凭据存在返回凭据详情", async () => {
			const app = makeApp();
			await request(app).post("/credentials").send({ credential_name: "aws-2" });
			const res = await request(app).get("/credentials/by_name/aws-2");
			expect(res.status).toBe(200);
			expect(res.body.credential_name).toBe("aws-2");
		});
	});

	describe("DELETE /credentials/:credentialName", () => {
		it("删除不存在的凭据返回 404", async () => {
			const app = makeApp();
			const res = await request(app).delete("/credentials/never-existed");
			expect(res.status).toBe(404);
		});

		it("删除存在的凭据返回 { success: true }", async () => {
			const app = makeApp();
			await request(app).post("/credentials").send({ credential_name: "aws-3" });
			const res = await request(app).delete("/credentials/aws-3");
			expect(res.status).toBe(200);
			expect(res.body).toEqual({ success: true });
		});
	});
});
