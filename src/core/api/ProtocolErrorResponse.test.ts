import express from "express";
import request from "supertest";
import { ApiError } from "./ApiError";
import { registerRoute } from "./registerRoute";
import { errorHandler } from "../../middleware/ErrorHandler";
import { RouterRateLimitErrorBasic } from "../../router/RouterErrors";

describe("protocol-aware API errors", () => {
	it("Anthropic route errors use the Anthropic error envelope and request id", async () => {
		const app = express();
		const router = express.Router();
		registerRoute(router, { method: "post", path: "/v1/messages" }, () => {
			throw ApiError.forbidden("route denied");
		});
		app.use(router);

		const response = await request(app).post("/v1/messages").expect(403);

		expect(response.headers["request-id"]).toMatch(/^req_[a-f0-9]{32}$/);
		expect(response.body).toEqual({
			type: "error",
			error: { type: "permission_error", message: "route denied" },
			request_id: response.headers["request-id"],
		});
	});

	it("middleware failures before the Anthropic handler use the same envelope", async () => {
		const app = express();
		app.use("/v1/messages", (_req, _res, next) => next(ApiError.unauthorized("missing key")));
		app.use(errorHandler);

		const response = await request(app).post("/v1/messages").expect(401);

		expect(response.body).toMatchObject({
			type: "error",
			error: { type: "authentication_error", message: "missing key" },
			request_id: response.headers["request-id"],
		});
	});

	it("OpenAI routes retain the OpenAI/LiteLLM error envelope", async () => {
		const app = express();
		const router = express.Router();
		registerRoute(router, { method: "post", path: "/v1/chat/completions" }, () => {
			throw ApiError.forbidden("route denied");
		});
		app.use(router);

		const response = await request(app).post("/v1/chat/completions").expect(403);

		expect(response.headers["request-id"]).toBeUndefined();
		expect(response.body).toEqual({
			error: { message: "route denied", type: "permission_denied", param: null, code: "403" },
		});
	});

	it("successful Anthropic responses include a request-id header", async () => {
		const app = express();
		const router = express.Router();
		registerRoute(router, { method: "post", path: "/v1/messages/count_tokens" }, () => ({ input_tokens: 2 }));
		app.use(router);

		const response = await request(app).post("/v1/messages/count_tokens").expect(200);

		expect(response.headers["request-id"]).toMatch(/^req_[a-f0-9]{32}$/);
		expect(response.body).toEqual({ input_tokens: 2 });
	});

	it("429 下发 Retry-After，让客户端 SDK 按真实冷却时间退避", async () => {
		const app = express();
		const router = express.Router();
		registerRoute(router, { method: "post", path: "/v1/chat/completions" }, () => {
			throw new RouterRateLimitErrorBasic("No deployments available for selected model", { cooldown_time: 5000 });
		});
		app.use(router);

		const response = await request(app).post("/v1/chat/completions").expect(429);

		expect(response.headers["retry-after"]).toBe("5");
	});

	it("Anthropic 429 同样带 Retry-After", async () => {
		const app = express();
		const router = express.Router();
		registerRoute(router, { method: "post", path: "/v1/messages" }, () => {
			throw new RouterRateLimitErrorBasic("No deployments available for selected model", { cooldown_time: 3000 });
		});
		app.use(router);

		const response = await request(app).post("/v1/messages").expect(429);

		expect(response.headers["retry-after"]).toBe("3");
		expect(response.body.error.type).toBe("rate_limit_error");
	});
});
