import http from "node:http";
import type { AddressInfo } from "node:net";
import type { NextFunction, Request, Response } from "express";
import WebSocket from "ws";
import type { ServiceContainer } from "../container";
import { PROXY_ADMIN_ROLE } from "../types/webUiSession";
import type {
	SessionTimelinePayload,
	SessionTimelineScope,
	SessionTimelineStreamState,
	SessionTimelineUpdate,
} from "./sessionTimelineLive";
import { registerSpendSessionTimelineStreamWebSocket, SPEND_SESSION_TIMELINE_STREAM_PATH } from "./sessionTimelineWebSocket";

interface StreamFrame {
	readonly type?: string;
	readonly group?: { readonly type?: string; readonly id?: string };
	readonly data?: Record<string, unknown>;
	readonly message?: string;
}

const summary: SessionTimelinePayload["summary"] = {
	keys: [{ alias: "key-1", hash: "hash-1" }],
	request_count: 2,
	event_count: 2,
	total_spend: 0.02,
	total_tokens: 20,
	duration_seconds: 10,
	start_time: "2026-01-01T00:00:00.000Z",
	end_time: "2026-01-01T00:00:10.000Z",
	filtered_request_count: 0,
	in_progress_request_count: 1,
};

const settledEvent = {
	id: "req-settled:request:0",
	request_id: "req-settled",
	role: "user" as const,
	label: "用户",
	timestamp: "2026-01-01T00:00:00.000Z",
	model: "gpt-test",
	content: "first question",
};

const activeEvent = {
	id: "req-running:request:0",
	request_id: "req-running",
	role: "assistant" as const,
	label: "助手",
	timestamp: "2026-01-01T00:00:10.000Z",
	model: "gpt-test",
	content: "partial output",
	status: "in_progress",
};

const snapshot: SessionTimelinePayload = {
	data: [settledEvent],
	summary: summary,
	active_requests: [{ request_id: "req-running", events: [activeEvent] }],
};

const update: SessionTimelineUpdate = {
	upsert: [settledEvent],
	summary: summary,
	active_requests: [{ request_id: "req-running", events: [activeEvent] }],
};

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

function createContainer(): ServiceContainer {
	return {
		authMiddleware: (req: Request, _res: Response, next: NextFunction) => {
			try {
				req.auth = { api_key: "test", models: [], user_role: PROXY_ADMIN_ROLE };
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

function createState(scripted: {
	snapshot: SessionTimelinePayload;
	updates: Array<SessionTimelineUpdate | null>;
}): SessionTimelineStreamState {
	let next = 0;
	return {
		snapshot: async () => scripted.snapshot,
		refresh: async () => {
			const value = scripted.updates[next] ?? null;
			next += 1;
			return value;
		},
	};
}

function openSocket(port: number, query = "session_group_type=session_id&session_group_id=session-1"): WebSocket {
	const socket = new WebSocket(`ws://127.0.0.1:${port}${SPEND_SESSION_TIMELINE_STREAM_PATH}?${query}`, [
		"litellm_test-key",
		"litellm-log-stream",
	]);
	// 快照可能在 open 的同一轮到达，先挂消息处理再等握手完成。
	socket.once("error", () => undefined);
	return socket;
}

async function waitOpen(socket: WebSocket): Promise<void> {
	if (socket.readyState === WebSocket.OPEN) {
		return;
	}
	await new Promise<void>((resolve, reject) => {
		socket.once("open", () => resolve());
		socket.once("error", reject);
	});
}

function collectFrames(socket: WebSocket): {
	readonly frames: StreamFrame[];
	waitFor(count: number, timeoutMs?: number): Promise<StreamFrame[]>;
} {
	const frames: StreamFrame[] = [];
	socket.on("message", (data: WebSocket.RawData) => {
		frames.push(JSON.parse(data.toString()) as StreamFrame);
	});
	return {
		frames: frames,
		waitFor: (count: number, timeoutMs = 2_000) =>
			new Promise<StreamFrame[]>((resolve, reject) => {
				const started = Date.now();
				const poll = (): void => {
					if (frames.length >= count) {
						resolve(frames);
						return;
					}
					if (Date.now() - started > timeoutMs) {
						reject(new Error(`expected ${count} frames, saw ${frames.length}`));
						return;
					}
					setTimeout(poll, 5);
				};
				poll();
			}),
	};
}

describe("session timeline stream", () => {
	it("sends a snapshot and then only incremental updates", async () => {
		const server = http.createServer();
		let receivedScope: SessionTimelineScope | null = null;
		registerSpendSessionTimelineStreamWebSocket(server, createContainer(), {
			createState: (_db, scope) => {
				receivedScope = scope;
				return createState({ snapshot: snapshot, updates: [update] });
			},
			refreshIntervalMs: 10,
		});
		const port = await listen(server);
		const socket = openSocket(port, "session_group_type=session_id&session_group_id=session-1&include_auxiliary=true");
		const stream = collectFrames(socket);
		await waitOpen(socket);

		try {
			const frames = await stream.waitFor(2);

			expect(frames[0]).toMatchObject({
				type: "snapshot",
				group: { type: "session_id", id: "session-1" },
				data: { data: [settledEvent], active_requests: [{ request_id: "req-running", events: [activeEvent] }] },
			});
			expect(frames[1]).toMatchObject({
				type: "update",
				group: { type: "session_id", id: "session-1" },
				data: { upsert: [settledEvent], active_requests: [{ request_id: "req-running", events: [activeEvent] }] },
			});
			expect(socket.protocol).toBe("litellm-log-stream");
			expect(receivedScope).not.toBeNull();
			expect(receivedScope!.groupKey).toBe("s:session-1");
			expect(receivedScope!.includeAuxiliary).toBe(true);
		} finally {
			await terminate(socket);
			await close(server);
		}
	});

	it("rejects the upgrade when the session group parameters are invalid", async () => {
		const server = http.createServer();
		registerSpendSessionTimelineStreamWebSocket(server, createContainer(), {
			createState: () => createState({ snapshot: snapshot, updates: [] }),
		});
		const port = await listen(server);
		const socket = new WebSocket(`ws://127.0.0.1:${port}${SPEND_SESSION_TIMELINE_STREAM_PATH}?session_group_type=unknown`, [
			"litellm_test-key",
			"litellm-log-stream",
		]);

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

	it("asks the client to reconnect when the subscription reaches its maximum lifetime", async () => {
		const server = http.createServer();
		registerSpendSessionTimelineStreamWebSocket(server, createContainer(), {
			createState: () => createState({ snapshot: snapshot, updates: [] }),
			refreshIntervalMs: 5,
			maxDurationMs: 30,
		});
		const port = await listen(server);
		const socket = openSocket(port);
		const stream = collectFrames(socket);
		const closed = new Promise<number>((resolve) => socket.once("close", (value) => resolve(value)));
		await waitOpen(socket);

		try {
			const frames = await stream.waitFor(2);
			expect(frames[0]!.type).toBe("snapshot");
			expect(frames[1]!.type).toBe("timeout");
			expect(await closed).toBe(1000);
		} finally {
			await terminate(socket);
			await close(server);
		}
	});
});
