import http from "node:http";
import type { AddressInfo } from "node:net";
import type { NextFunction, Request, Response } from "express";
import WebSocket from "ws";
import { ApiError } from "../core/api/ApiError";
import type { ServiceContainer } from "../container";
import { registerSpendLogUpdatesWebSocket, SPEND_LOG_UPDATES_PATH } from "./logUpdatesWebSocket";
import { publishSpendLogChange } from "./spendLogChangeFeed";

interface ChangeFrame {
	readonly type?: string;
	readonly [key: string]: unknown;
}

async function listen(server: http.Server): Promise<number> {
	await new Promise<void>((resolve, reject) => {
		server.listen(0, "127.0.0.1", resolve);
		server.once("error", reject);
	});
	return (server.address() as AddressInfo).port;
}

async function close(server: http.Server): Promise<void> {
	server.closeAllConnections();
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

async function terminate(socket: WebSocket): Promise<void> {
	if (socket.readyState === WebSocket.CLOSED) {
		return;
	}
	await new Promise<void>((resolve) => {
		socket.once("close", () => resolve());
		socket.terminate();
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

async function connect(port: number): Promise<WebSocket> {
	const socket = new WebSocket(`ws://127.0.0.1:${port}${SPEND_LOG_UPDATES_PATH}`, [
		"litellm_test-key",
		"litellm-log-stream",
	]);
	await new Promise<void>((resolve, reject) => {
		socket.once("open", resolve);
		socket.once("error", reject);
	});
	return socket;
}

function nextFrame(socket: WebSocket, timeoutMs = 2_000): Promise<ChangeFrame> {
	return new Promise<ChangeFrame>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("no change frame")), timeoutMs);
		socket.once("message", (data) => {
			clearTimeout(timer);
			resolve(JSON.parse(data.toString()) as ChangeFrame);
		});
	});
}

describe("spend log list updates stream", () => {
	it("pushes only a change notice and never carries log data", async () => {
		const server = http.createServer();
		registerSpendLogUpdatesWebSocket(server, createContainer());
		const port = await listen(server);
		const socket = await connect(port);

		try {
			const first = nextFrame(socket);
			publishSpendLogChange();
			const frame = await first;

			expect(frame).toEqual({ type: "logs_changed" });
			expect(Object.keys(frame)).toEqual(["type"]);
			expect(socket.protocol).toBe("litellm-log-stream");
		} finally {
			await terminate(socket);
			await close(server);
		}
	});

	it("coalesces a burst of writes into one notice per subscription", async () => {
		const server = http.createServer();
		registerSpendLogUpdatesWebSocket(server, createContainer());
		const port = await listen(server);
		const socket = await connect(port);
		const frames: ChangeFrame[] = [];

		try {
			socket.on("message", (data) => {
				frames.push(JSON.parse(data.toString()) as ChangeFrame);
			});
			publishSpendLogChange();
			publishSpendLogChange();
			publishSpendLogChange();
			await new Promise((resolve) => setTimeout(resolve, 250));
			expect(frames).toEqual([{ type: "logs_changed" }]);
		} finally {
			await terminate(socket);
			await close(server);
		}
	});

	it("fans the same change notice out to every connected subscriber", async () => {
		const server = http.createServer();
		registerSpendLogUpdatesWebSocket(server, createContainer());
		const port = await listen(server);
		const first = await connect(port);
		const second = await connect(port);

		try {
			const firstFrame = nextFrame(first);
			const secondFrame = nextFrame(second);
			publishSpendLogChange();

			expect(await firstFrame).toEqual({ type: "logs_changed" });
			expect(await secondFrame).toEqual({ type: "logs_changed" });
		} finally {
			await terminate(first);
			await terminate(second);
			await close(server);
		}
	});

	it("rejects the upgrade when the key cannot be authenticated", async () => {
		const server = http.createServer();
		registerSpendLogUpdatesWebSocket(
			server,
			createContainer(() => {
				throw ApiError.unauthorized("bad key");
			}),
		);
		const port = await listen(server);
		const socket = new WebSocket(`ws://127.0.0.1:${port}${SPEND_LOG_UPDATES_PATH}`, ["bad-key", "litellm-log-stream"]);

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
