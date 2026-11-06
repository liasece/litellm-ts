import http from "node:http";
import net, { type AddressInfo } from "node:net";
import type { NextFunction, Request, Response } from "express";
import WebSocket from "ws";
import { ApiError } from "../core/api/ApiError";
import type { ServiceContainer } from "../container";
import { registerSpendLogStreamWebSocket, SPEND_LOG_STREAM_PATH } from "./logStreamWebSocket";

interface StreamFrame {
	readonly type?: string;
	readonly data?: Record<string, unknown>;
	readonly message?: string;
}

async function listen(server: http.Server): Promise<number> {
	await new Promise<void>((resolve, reject) => {
		server.listen(0, "127.0.0.1", resolve);
		server.once("error", reject);
	});
	return (server.address() as AddressInfo).port;
}

/** 断开客户端并等到底层连接真正关闭，避免 Jest 收尾时还挂着半开 socket。 */
async function terminate(socket: WebSocket): Promise<void> {
	await new Promise<void>((resolve) => {
		if (socket.readyState === WebSocket.CLOSED) {
			resolve();
			return;
		}
		socket.once("close", () => resolve());
		socket.terminate();
	});
}

async function close(server: http.Server): Promise<void> {
	// 保留的 keep-alive / 半开连接会让 Jest 无法退出，先断开再关闭监听。
	server.closeAllConnections();
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

function createContainer(onAuth?: (req: Request) => void): ServiceContainer {
	return {
		authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
			try {
				req.auth = { api_key: "test", models: [] };
				onAuth?.(req);
				next();
			} catch (error) {
				next(error);
			}
		},
		authorizationGuard: {
			middleware: () => (_req: Request, _res: Response, next: NextFunction) => next(),
		},
		db: { db: {} },
	} as unknown as ServiceContainer;
}

describe("spend log detail stream", () => {
	it("pushes a snapshot, then only changed fields, then the final payload", async () => {
		const server = http.createServer();
		const revisions = [
			{ present: true, updatedAt: "2026-11-05T00:00:00.000Z", status: "in_progress" },
			{ present: true, updatedAt: "2026-11-05T00:00:02.000Z", status: "in_progress" },
			{ present: false, updatedAt: null, status: null },
		];
		const details = [
			{
				status: "in_progress",
				request_id: "req-stream",
				response: { text: "he" },
				proxy_server_request: { body: { model: "m" } },
				metadata: { status: "in_progress" },
			},
			{
				status: "in_progress",
				request_id: "req-stream",
				response: { text: "hello" },
				proxy_server_request: { body: { model: "m" } },
				metadata: { status: "in_progress" },
			},
		];
		let detailIndex = 0;
		let revisionCursor = 0;
		registerSpendLogStreamWebSocket(server, createContainer(), {
			pollIntervalMs: 10,
			readRevision: async () => revisions[Math.min(revisionCursor, revisions.length - 1)]!,
			loadActiveDetail: async () => details[Math.min(detailIndex++, details.length - 1)]!,
			loadSettledDetail: async () => ({ messages: [{ role: "user" }], response: { text: "hello" } }),
		});
		const port = await listen(server);
		const socket = new WebSocket(`ws://127.0.0.1:${port}${SPEND_LOG_STREAM_PATH}?request_id=req-stream`, [
			"litellm_test-key",
			"litellm-log-stream",
		]);
		const frames: StreamFrame[] = [];

		try {
			await new Promise<void>((resolve, reject) => {
				socket.on("message", (data) => {
					frames.push(JSON.parse(data.toString()) as StreamFrame);
					// 第一次快照之后推进修订号，模拟 checkpoint 补写。
					if (frames.length === 1) {
						revisionCursor = 1;
						setTimeout(() => {
							revisionCursor = 2;
						}, 40);
					}
					if (frames.at(-1)?.type === "final") {
						resolve();
					}
				});
				socket.once("error", reject);
				setTimeout(() => reject(new Error("stream did not finish")), 5_000);
			});

			expect(socket.protocol).toBe("litellm-log-stream");
			expect(frames[0]).toEqual({
				type: "snapshot",
				request_id: "req-stream",
				data: details[0],
			});
			expect(frames[1]).toEqual({
				type: "patch",
				request_id: "req-stream",
				data: { response: { text: "hello" } },
			});
			expect(frames[2]).toEqual({
				type: "final",
				request_id: "req-stream",
				data: { messages: [{ role: "user" }], response: { text: "hello" } },
			});
		} finally {
			await terminate(socket);
			await close(server);
		}
	});

	it("rejects the upgrade without a valid request_id", async () => {
		const server = http.createServer();
		registerSpendLogStreamWebSocket(server, createContainer(), { pollIntervalMs: 10 });
		const port = await listen(server);
		const socket = new WebSocket(`ws://127.0.0.1:${port}${SPEND_LOG_STREAM_PATH}`, ["litellm_test-key", "litellm-log-stream"]);

		try {
			const error = await new Promise<Error>((resolve) => {
				socket.once("error", (value) => resolve(value as Error));
			});
			expect(error.message).toContain("400");
		} finally {
			await terminate(socket);
			await close(server);
		}
	});

	it("reports a gone frame when the request vanished without a settled log", async () => {
		const server = http.createServer();
		registerSpendLogStreamWebSocket(server, createContainer(), {
			pollIntervalMs: 10,
			readRevision: async () => ({ present: false, updatedAt: null, status: null }),
			loadSettledDetail: async () => null,
		});
		const port = await listen(server);
		const socket = new WebSocket(`ws://127.0.0.1:${port}${SPEND_LOG_STREAM_PATH}?request_id=req-gone`, [
			"litellm_test-key",
			"litellm-log-stream",
		]);

		try {
			const result = await new Promise<{ frame: StreamFrame; code: number | null }>((resolve, reject) => {
				let closeCode: number | null = null;
				socket.on("message", (data) => {
					const frame = JSON.parse(data.toString()) as StreamFrame;
					if (frame.type === "gone") {
						resolve({ frame, code: closeCode });
					}
				});
				socket.on("close", (code) => {
					closeCode = code;
				});
				socket.once("error", reject);
				setTimeout(() => reject(new Error("no gone frame")), 5_000);
			});
			expect(result.frame).toEqual({ type: "gone", request_id: "req-gone" });
		} finally {
			await terminate(socket);
			await close(server);
		}
	});

	it("keeps serving after a client resets the connection mid-handshake", async () => {
		const server = http.createServer();
		// 鉴权是异步的（查库），客户端可能在这段时间里直接消失。
		const slowContainer = {
			authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
				req.auth = { api_key: "test", models: [] };
				setTimeout(next, 60);
			},
			authorizationGuard: { middleware: () => (_req: Request, _res: Response, next: NextFunction) => next() },
			db: { db: {} },
		} as unknown as ServiceContainer;
		registerSpendLogStreamWebSocket(server, slowContainer, {
			pollIntervalMs: 10,
			readRevision: async () => ({ present: false, updatedAt: null, status: null }),
			loadSettledDetail: async () => ({ messages: [], response: null }),
		});
		const port = await listen(server);

		try {
			await new Promise<void>((resolve) => {
				const raw = net.connect(port, "127.0.0.1", () => {
					raw.write(
						"GET /spend/logs/ui/stream?request_id=req-rst HTTP/1.1\r\nHost: probe\r\n" +
							"Upgrade: websocket\r\nConnection: Upgrade\r\n" +
							"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n" +
							"Sec-WebSocket-Protocol: litellm_test, litellm-log-stream\r\n\r\n",
					);
					setTimeout(() => {
						raw.resetAndDestroy();
						resolve();
					}, 5);
				});
				raw.on("error", () => resolve());
			});
			await new Promise((resolve) => setTimeout(resolve, 150));

			// 握手期的连接错误必须只终结那一条连接，进程与后续订阅都还在。
			const socket = new WebSocket(`ws://127.0.0.1:${port}${SPEND_LOG_STREAM_PATH}?request_id=req-rst`, [
				"litellm_test",
				"litellm-log-stream",
			]);
			const frame = await new Promise<StreamFrame>((resolve, reject) => {
				socket.once("message", (data) => resolve(JSON.parse(data.toString()) as StreamFrame));
				socket.once("error", reject);
			});
			expect(frame.type).toBe("final");
			await terminate(socket);
		} finally {
			await close(server);
		}
	});

	it("rejects the upgrade when the key cannot be authenticated", async () => {
		const server = http.createServer();
		registerSpendLogStreamWebSocket(
			server,
			createContainer(() => {
				throw ApiError.unauthorized("bad key");
			}),
			{ pollIntervalMs: 10 },
		);
		const port = await listen(server);
		const socket = new WebSocket(`ws://127.0.0.1:${port}${SPEND_LOG_STREAM_PATH}?request_id=req-1`, [
			"bad-key",
			"litellm-log-stream",
		]);

		try {
			const error = await new Promise<Error>((resolve) => {
				socket.once("error", (value) => resolve(value as Error));
			});
			expect(error.message).toContain("401");
		} finally {
			await terminate(socket);
			await close(server);
		}
	});
});
