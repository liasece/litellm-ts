import express from "express";
import request from "supertest";
import { requestArrivalMiddleware, requestArrivalTime } from "./RequestArrival";

describe("请求到达时刻", () => {
	it("在路由与 handler 之前打点，后续中间件的等待不影响起点", async () => {
		const app = express();
		app.use(requestArrivalMiddleware);
		app.use((_req, _res, next) => {
			setTimeout(next, 25);
		});
		let handlerAt = 0;
		app.get("/probe", (req, res) => {
			handlerAt = Date.now();
			res.json({ at: req.litellmRequestArrivalAt, start: requestArrivalTime(req).toISOString() });
		});
		const response = await request(app).get("/probe").expect(200);
		const start = new Date(response.body.start as string).getTime();
		expect(typeof response.body.at).toBe("number");
		expect(start).toBe(response.body.at);
		// 到达时刻早于 handler，且把中间件里 25ms 的等待包含进来。
		expect(start).toBeLessThanOrEqual(handlerAt);
		expect(handlerAt - start).toBeGreaterThanOrEqual(20);
	});

	it("重复挂载保留最早的到达时刻", async () => {
		const app = express();
		app.use(requestArrivalMiddleware);
		const first = { value: 0 };
		app.use((req, _res, next) => {
			first.value = req.litellmRequestArrivalAt ?? 0;
			next();
		});
		app.use((_req, _res, next) => {
			setTimeout(next, 10);
		});
		app.use(requestArrivalMiddleware);
		app.get("/probe", (req, res) => {
			res.json({ at: req.litellmRequestArrivalAt });
		});
		const response = await request(app).get("/probe").expect(200);
		expect(response.body.at).toBe(first.value);
	});

	it("未经过到达中间件时退回当前时间", () => {
		const now = Date.now();
		const start = requestArrivalTime({}).getTime();
		expect(Math.abs(start - now)).toBeLessThan(1000);
	});
});
