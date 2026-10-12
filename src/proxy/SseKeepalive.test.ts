import express from "express";
import request from "supertest";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { sseKeepaliveMiddleware } from "./SseKeepalive";
import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { resolveKeepaliveSeconds, startSseKeepalive } from "./SseKeepalive";
import { dbConfigProvider } from "../core/config/DbConfigProvider";

describe("SSE keepalive policy and lifetime", () => {
	afterEach(() => {
		jest.useRealTimers();
		jest.restoreAllMocks();
	});
	it("requires operator opt-in for overrides, respects hard disable and clamps bounds", () => {
		const req = { body: { keepalive_seconds: 20 }, get: () => "3" } as unknown as Pick<Request, "body" | "get">;
		expect(resolveKeepaliveSeconds({}, req, 10)).toBe(10);
		expect(resolveKeepaliveSeconds({ allow_client_keepalive_override: true }, req, 10)).toBe(3);
		expect(resolveKeepaliveSeconds({ keepalive_seconds: 0, allow_client_keepalive_override: true }, req, 10)).toBe(0);
		expect(resolveKeepaliveSeconds({ keepalive_seconds: 1000 }, req, 10)).toBe(300);
	});
	it("sends transport-only pings while waiting and stops immediately on close", async () => {
		jest.useFakeTimers();
		jest.spyOn(dbConfigProvider, "getEffectiveParam").mockResolvedValue({ sse_keepalive_ping_interval_seconds: 1 });
		const req = Object.assign(new EventEmitter(), { body: {}, get: () => undefined }) as unknown as Request;
		const write = jest.fn();
		const res = Object.assign(new EventEmitter(), {
			write: write,
			locals: {},
			headersSent: true,
			destroyed: false,
			writableEnded: false,
		}) as unknown as Response;
		const stop = await startSseKeepalive(req, res, undefined, "anthropic");
		jest.advanceTimersByTime(1000);
		expect(write).toHaveBeenCalledWith('event: ping\ndata: {"type":"ping"}\n\n');
		res.emit("close");
		jest.advanceTimersByTime(5000);
		expect(write).toHaveBeenCalledTimes(1);
		expect(jest.getTimerCount()).toBe(0);
		stop();
	});

	it("keeps a request alive before provider/tool output and terminates a late SSE error", async () => {
		jest.spyOn(dbConfigProvider, "getEffectiveParam").mockResolvedValue({ sse_keepalive_ping_interval_seconds: 1 });
		const deployment = { model_name: "a", litellm_params: { model: "openai/a" }, model_info: { id: "a" } };
		const router = { hasModel: () => true, getDeploymentIdsForModel: () => ["a"], getDeployment: () => deployment };
		const app = express();
		app.use(express.json());
		app.use(sseKeepaliveMiddleware(router as never));
		registerRoute(app, { method: "post", path: "/v1/chat/completions" }, async () => {
			await new Promise((resolve) => setTimeout(resolve, 1100));
			throw ApiError.unavailable("late provider error");
		});
		const response = await request(app).post("/v1/chat/completions").send({ model: "a", stream: true });
		expect(response.status).toBe(200);
		expect(response.text.indexOf(": keepalive")).toBeLessThan(response.text.indexOf("late provider error"));
		expect(response.text).toContain("late provider error");
	});
});
