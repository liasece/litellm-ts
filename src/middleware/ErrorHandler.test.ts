import type { NextFunction, Request, Response } from "express";
import express from "express";
import request from "supertest";
import { ApiError } from "../core/api/ApiError";
import { errorHandler } from "./ErrorHandler";

jest.mock("../core/utils/logger", () => {
	const child = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
	return {
		createModuleLogger: () => child,
		toErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
		__child: child,
	};
});

const loggerMock = (jest.requireMock("../core/utils/logger") as { __child: { warn: jest.Mock; error: jest.Mock } }).__child;

/**
 * 构造 raw-body 在客户端中断请求体时抛出的错误形状。
 *
 * 见 node_modules/raw-body：onAborted 调用 createError(400, "request aborted",
 * { code: "ECONNRESET", type: "request.aborted" })。
 */
function requestAbortedError(): Error & { status: number; code: string; type: string } {
	const error = new Error("request aborted") as Error & { status: number; code: string; type: string };
	error.status = 400;
	error.code = "ECONNRESET";
	error.type = "request.aborted";
	return error;
}

function appThrowing(error: unknown): express.Express {
	const app = express();
	app.post("/v1/messages", (_req, _res, next) => {
		next(error);
	});
	app.use(errorHandler);
	return app;
}

beforeEach(() => {
	loggerMock.warn.mockClear();
	loggerMock.error.mockClear();
});

describe("errorHandler 对客户端中断的处理", () => {
	it("请求体传输中断时不记服务端错误，按 400 invalid_request_error 返回", async () => {
		const response = await request(appThrowing(requestAbortedError())).post("/v1/messages").send({ model: "claude-sonnet-4" });

		expect(response.status).toBe(400);
		// /v1/messages 走 Anthropic 错误信封，与正常业务错误保持同一条协议路径。
		expect(response.body).toEqual({
			type: "error",
			error: {
				message: "Client closed request before the request body was fully received",
				type: "invalid_request_error",
			},
			request_id: expect.stringMatching(/^req_/),
		});
		expect(loggerMock.error).not.toHaveBeenCalled();
		expect(loggerMock.warn).toHaveBeenCalledWith(
			"客户端在请求体传输中断开",
			expect.objectContaining({ method: "POST", url: "/v1/messages", error: "request aborted" }),
		);
		expect(loggerMock.warn.mock.calls[0]?.[1]).not.toHaveProperty("stack");
	});

	it("非 body-parser 的中断错误在请求确实中断时同样按客户端中断处理", async () => {
		const app = express();
		app.post("/v1/messages", (req, _res, next) => {
			(req as Request & { aborted?: boolean }).aborted = true;
			next(Object.assign(new Error("aborted"), { code: "ECONNRESET" }));
		});
		app.use(errorHandler);

		const response = await request(app).post("/v1/messages").send({ model: "claude-sonnet-4" });

		expect(response.status).toBe(400);
		expect(loggerMock.error).not.toHaveBeenCalled();
	});

	it("仅消息形似中断、连接并未中断时仍按服务端错误记录", async () => {
		const response = await request(appThrowing(new Error("aborted")))
			.post("/v1/messages")
			.send({ model: "claude-sonnet-4" });

		expect(response.status).toBe(500);
		expect(loggerMock.error).toHaveBeenCalledWith("未处理的请求错误", expect.objectContaining({ error: "aborted" }));
	});

	it("连接已不可写时只把状态码对齐到 400，不再尝试回包", () => {
		const req = { method: "POST", originalUrl: "/v1/messages", aborted: true, headers: {} } as unknown as Request;
		const status = jest.fn();
		const json = jest.fn();
		const res = {
			statusCode: 200,
			headersSent: false,
			writableEnded: false,
			destroyed: true,
			status: status,
			json: json,
			getHeader: jest.fn(),
			setHeader: jest.fn(),
		} as unknown as Response;

		errorHandler(requestAbortedError(), req, res, jest.fn() as NextFunction);

		expect(res.statusCode).toBe(400);
		expect(status).not.toHaveBeenCalled();
		expect(json).not.toHaveBeenCalled();
		expect(loggerMock.error).not.toHaveBeenCalled();
	});
});

describe("errorHandler 保留原有的错误分级", () => {
	it("未知异常仍按 500 记录并带堆栈", async () => {
		const failure = new Error("unexpected failure");
		const response = await request(appThrowing(failure)).post("/v1/messages").send({ model: "claude-sonnet-4" });

		expect(response.status).toBe(500);
		expect(loggerMock.error).toHaveBeenCalledWith("未处理的请求错误", expect.objectContaining({ stack: failure.stack }));
	});

	it("业务 ApiError 不因连接同时断开被改判为客户端中断", async () => {
		const app = express();
		app.post("/v1/messages", (req, _res, next) => {
			(req as Request & { aborted?: boolean }).aborted = true;
			next(new ApiError(500, "upstream pipeline failed"));
		});
		app.use(errorHandler);

		const response = await request(app).post("/v1/messages").send({ model: "claude-sonnet-4" });

		expect(response.status).toBe(500);
		expect(loggerMock.warn).toHaveBeenCalledWith("API 错误", expect.objectContaining({ statusCode: 500 }));
		expect(loggerMock.warn).not.toHaveBeenCalledWith("客户端在请求体传输中断开", expect.anything());
	});
});
