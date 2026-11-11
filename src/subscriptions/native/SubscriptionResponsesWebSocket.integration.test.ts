import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { ApiError } from "../../core/api/ApiError";
import { setSubscriptionRequestHandler } from "../../router/SubscriptionDispatch";
import { SubscriptionBridge } from "./bridge";
import { SubscriptionAccountScheduler } from "./scheduler";
import { registerSubscriptionResponsesWebSocket } from "./SubscriptionResponsesWebSocket";
import type { SubscriptionAccount, SubscriptionProviderAdapter } from "./types";

const ACCOUNT: SubscriptionAccount = {
	id: "codex-1",
	source: "codex",
	fileName: "codex-test.json",
	path: "/tmp/codex-test.json",
	disabled: false,
	weight: 1,
	raw: { type: "codex", access_token: "token", account_id: "acct" },
};

const DEPLOYMENT = {
	model_name: "client-model",
	litellm_params: { model: "codex-subscription/client-model", custom_llm_provider: "codex-subscription" },
	model_info: { id: "dep-codex" },
};

interface Harness {
	readonly server: Server;
	readonly url: string;
	readonly calls: Array<Record<string, unknown>>;
	allow: boolean;
	close: () => Promise<void>;
}

function adapter(calls: Array<Record<string, unknown>>): SubscriptionProviderAdapter {
	return {
		source: "codex",
		displayName: "Codex",
		auth: {
			source: "codex",
			ensureCredential: async () => "token",
			refresh: async () => undefined,
		},
		supports: () => true,
		route: () => "responses",
		resolveModel: (model) => model,
		build: async (context) => {
			calls.push(context.body);
			return {
				url: "https://upstream.test/responses",
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: context.body,
				model: context.model,
				stream: true,
				protocol: "responses",
			};
		},
		catalog: async () => [],
		quota: async () => ({ fetchedAt: new Date().toISOString() }),
	};
}

async function buildHarness(): Promise<Harness> {
	const calls: Array<Record<string, unknown>> = [];
	const provider = adapter(calls);
	const bridge = new SubscriptionBridge({
		accounts: {
			list: async () => [ACCOUNT],
			findByFileName: async () => ACCOUNT,
		} as never,
		scheduler: new SubscriptionAccountScheduler(),
		providers: {
			get: (source) => (source === "codex" ? provider : undefined),
			list: () => [provider],
		},
	});
	setSubscriptionRequestHandler((req, options) => bridge.execute(req, options));
	const router = {
		getAvailableDeployment: () => ({ deployment: DEPLOYMENT, provider: {} }),
		getDeployments: () => [DEPLOYMENT],
		recordDeploymentSuccess: () => undefined,
		recordDeploymentFailure: () => undefined,
	};
	const container = {
		router: router,
		runtimeConfigService: { runWithSnapshot: async (_router: unknown, callback: () => Promise<unknown>) => await callback() },
		authMiddleware: (req: { auth?: unknown }, _res: unknown, next: (error?: unknown) => void) => {
			if (!harness.allow) {
				next(ApiError.unauthorized("API 密钥无效"));
				return;
			}
			req.auth = { api_key: "sk-test", user_id: "user-1" };
			next();
		},
		authorizationGuard: { middleware: () => (_req: unknown, _res: unknown, next: () => void) => next() },
	};
	const server = createServer();
	registerSubscriptionResponsesWebSocket(server, container as never);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address() as AddressInfo;
	const harness: Harness = {
		server: server,
		url: `ws://127.0.0.1:${address.port}/v1/responses`,
		calls: calls,
		allow: true,
		close: async () => {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
	return harness;
}

class MessageQueue {
	private readonly queue: Array<Record<string, unknown>> = [];
	private readonly waiters: Array<(value: Record<string, unknown>) => void> = [];

	constructor(socket: WebSocket) {
		socket.on("message", (data: WebSocket.RawData) => {
			const value = JSON.parse(data.toString()) as Record<string, unknown>;
			const waiter = this.waiters.shift();
			if (waiter) {
				waiter(value);
			} else {
				this.queue.push(value);
			}
		});
	}

	next(): Promise<Record<string, unknown>> {
		const value = this.queue.shift();
		if (value) {
			return Promise.resolve(value);
		}
		return new Promise((resolve) => this.waiters.push(resolve));
	}
}

function open(url: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url, { headers: { authorization: "Bearer sk-test" } });
		socket.once("open", () => resolve(socket));
		socket.once("error", reject);
	});
}

function sse(events: unknown[]): Response {
	const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
	return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

afterEach(() => {
	setSubscriptionRequestHandler(undefined);
	jest.restoreAllMocks();
});

it("WebSocket 逐帧转发 Responses 事件并支持 previous_response_id 合并", async () => {
	const harness = await buildHarness();
	const socket = await open(harness.url);
	const messages = new MessageQueue(socket);
	try {
		jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			sse([
				{ type: "response.created", response: { id: "resp_1", status: "in_progress", output: [] } },
				{
					type: "response.output_item.done",
					output_index: 0,
					item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "hello" }] },
				},
				{
					type: "response.completed",
					response: {
						id: "resp_1",
						status: "completed",
						output: [],
						usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
					},
				},
			]),
		);
		socket.send(
			JSON.stringify({
				type: "response.create",
				model: "client-model",
				input: [{ role: "user", content: "hi" }],
			}),
		);
		expect((await messages.next())["type"]).toBe("response.created");
		expect((await messages.next())["type"]).toBe("response.output_item.done");
		expect((await messages.next())["type"]).toBe("response.completed");

		jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			sse([
				{ type: "response.created", response: { id: "resp_2", status: "in_progress", output: [] } },
				{ type: "response.completed", response: { id: "resp_2", status: "completed", output: [] } },
			]),
		);
		socket.send(
			JSON.stringify({
				type: "response.create",
				model: "client-model",
				previous_response_id: "resp_1",
				input: [{ role: "user", content: "again" }],
			}),
		);
		expect((await messages.next())["type"]).toBe("response.created");
		expect((await messages.next())["type"]).toBe("response.completed");
		expect(harness.calls).toHaveLength(2);
		const second = harness.calls[1] as { input: unknown[]; previous_response_id?: string };
		expect(second.previous_response_id).toBeUndefined();
		expect(second.input).toHaveLength(3);
		expect(second.input[1]).toMatchObject({ type: "message" });
	} finally {
		socket.close();
		await harness.close();
	}
});

it("每轮重新鉴权，撤销密钥后不再发起上游请求", async () => {
	const harness = await buildHarness();
	const socket = await open(harness.url);
	const messages = new MessageQueue(socket);
	try {
		jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			sse([{ type: "response.completed", response: { id: "resp_1", status: "completed", output: [] } }]),
		);
		socket.send(JSON.stringify({ type: "response.create", model: "client-model", input: [] }));
		expect((await messages.next())["type"]).toBe("response.completed");
		harness.allow = false;
		socket.send(JSON.stringify({ type: "response.create", model: "client-model", input: [] }));
		const error = await messages.next();
		expect(error["type"]).toBe("error");
		expect(error["status"]).toBe(401);
		expect(harness.calls).toHaveLength(1);
	} finally {
		socket.close();
		await harness.close();
	}
});
