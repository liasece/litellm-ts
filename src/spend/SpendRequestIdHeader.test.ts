import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import type { Request, Response, NextFunction } from "express";
import { SPEND_REQUEST_ID_HEADER, spendRequestIdHeaderMiddleware } from "./SpendRequestIdHeader";
import type { UserAPIKeyAuth } from "../types/auth";

function makeApp(auth: UserAPIKeyAuth) {
	const app = express();
	app.use((req: Request, _res: Response, next: NextFunction) => {
		req.auth = auth;
		next();
	});
	app.use(spendRequestIdHeaderMiddleware);
	app.get("/probe", (_req, res) => res.json({ ok: true }));
	return app;
}

describe("spend request id response header", () => {
	it("exposes the same deterministic id that spend logging uses, without the key", async () => {
		const auth = { api_key: "sk-company-secret", token: "company-token-hash" };
		const response = await request(makeApp(auth)).get("/probe").set("x-request-id", "client-1");
		const expected = createHash("sha256").update("company-token-hash").update("\0").update("client-1").digest("hex");

		expect(response.status).toBe(200);
		expect(response.headers[SPEND_REQUEST_ID_HEADER]).toBe(expected);
		expect(response.headers[SPEND_REQUEST_ID_HEADER]).not.toContain("sk-company-secret");
		expect(response.headers[SPEND_REQUEST_ID_HEADER]).not.toContain("company-token-hash");
	});

	it("uses an opaque UUID when the caller did not send a stable request id", async () => {
		const response = await request(makeApp({ api_key: "sk-company-secret", token: "company-token-hash" })).get("/probe");
		const header = String(response.headers[SPEND_REQUEST_ID_HEADER] ?? "");

		expect(header).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
		expect(header).not.toContain("sk-company-secret");
	});

	it("keeps different companies on different ids for the same client request id", async () => {
		const first = await request(makeApp({ api_key: "sk-a", token: "token-a" }))
			.get("/probe")
			.set("x-request-id", "same");
		const second = await request(makeApp({ api_key: "sk-b", token: "token-b" }))
			.get("/probe")
			.set("x-request-id", "same");

		expect(first.headers[SPEND_REQUEST_ID_HEADER]).toBeDefined();
		expect(first.headers[SPEND_REQUEST_ID_HEADER]).not.toBe(second.headers[SPEND_REQUEST_ID_HEADER]);
	});
});
