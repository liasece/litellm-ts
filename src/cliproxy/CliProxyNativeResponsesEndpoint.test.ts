import { codingClientModelMiddleware } from "../proxy/CodingClientModels";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import type { Router as LiteLLMRouter } from "../router/Router";
import type { Deployment } from "../types/router";
import type { CliProxyRuntimeManager } from "./CliProxyRuntimeManager";
import {
	registerCliProxyNativeChatRoutes,
	registerCliProxyNativeAnthropicRoutes,
	registerCliProxyNativeResponsesRoutes,
} from "./CliProxyNativeResponsesEndpoint";
import { CliProxyProvider } from "../providers/CliProxyProvider";
import { SpendLogStatus } from "../types/spend";

const mockBuildSpendLogFromRequest = jest.fn(async (_context: unknown) => ({}));
const mockTrackSpendLog = jest.fn(async (_db: unknown, _log: unknown) => ({ status: "committed", requestId: "test-request" }));

jest.mock("../spend/SpendTracker", () => {
	const actual = jest.requireActual<typeof import("../spend/SpendTracker")>("../spend/SpendTracker");
	return {
		...actual,
		buildSpendLogFromRequest: (context: unknown) => mockBuildSpendLogFromRequest(context),
		trackSpendLog: (db: unknown, log: unknown) => mockTrackSpendLog(db, log),
	};
});

function buildApp(
	reasoningEffortOverride?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
	authenticated = false,
): express.Express {
	const deployment: Deployment = {
		model_name: "gpt-5.6-sol",
		litellm_params: {
			model: "cliproxy/gpt-5.6-sol",
			custom_llm_provider: "cliproxy",
		},
		model_info: reasoningEffortOverride ? { override_reasoning_effort: reasoningEffortOverride } : undefined,
	};
	const router = {
		hasModel: () => true,
		getAvailableDeployment: () => ({ deployment: deployment }),
		getDeployments: () => [deployment],
		getFallbacks: () => ({}),
		recordDeploymentSuccess: jest.fn(),
		recordDeploymentFailure: jest.fn(),
	} as unknown as LiteLLMRouter;
	const runtime = {
		baseUrl: "http://127.0.0.1:8317",
		internalApiKey: "internal-only",
	} as CliProxyRuntimeManager;
	const app = express();
	app.use(express.json());
	app.use(codingClientModelMiddleware(router));
	if (authenticated) {
		app.use((req, _res, next) => {
			req.auth = { api_key: "test-key", models: ["gpt-5.6-sol"] };
			next();
		});
	}
	const expressRouter = express.Router();
	registerCliProxyNativeResponsesRoutes(expressRouter, router, runtime, undefined as never);
	registerCliProxyNativeChatRoutes(expressRouter, router, runtime, undefined as never);
	app.use(expressRouter);
	return app;
}

function buildAnthropicApp(routerOverride?: LiteLLMRouter): express.Express {
	const deployment: Deployment = {
		model_name: "gpt-5.6-sol",
		litellm_params: {
			model: "cliproxy/gpt-5.6-sol",
			custom_llm_provider: "cliproxy",
		},
	};
	const provider = new CliProxyProvider("internal-only", "http://127.0.0.1:8317");
	const router =
		routerOverride ??
		({
			getAvailableDeployment: () => ({ deployment: deployment, provider: provider }),
			getDeployments: () => [deployment],
			getFallbacks: () => ({}),
			getNextFallback: () => null,
			hasModel: () => true,
			getNoAvailableDeploymentInfo: () => ({}),
			maxFallbacks: 5,
			recordDeploymentSuccess: jest.fn(),
			recordDeploymentFailure: jest.fn(),
		} as unknown as LiteLLMRouter);
	const runtime = {
		baseUrl: "http://127.0.0.1:8317",
		internalApiKey: "internal-only",
	} as CliProxyRuntimeManager;
	const app = express();
	app.use(express.json());
	app.use(codingClientModelMiddleware(router));
	app.use((req, _res, next) => {
		req.auth = { api_key: "test-key", models: ["gpt-5.6-sol", "k3"] };
		next();
	});
	const expressRouter = express.Router();
	registerCliProxyNativeAnthropicRoutes(expressRouter, router, runtime, undefined as never);
	app.use(expressRouter);
	return app;
}

async function closeServer(server: http.Server): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

describe("CLIProxy native Responses streaming", () => {
	afterEach(() => {
		jest.restoreAllMocks();
		jest.clearAllMocks();
	});

	it("establishes SSE and sends a keepalive before CLIProxy produces its first response", async () => {
		let resolveUpstream!: (response: Response) => void;
		const upstream = new Promise<Response>((resolve) => {
			resolveUpstream = resolve;
		});
		const fetchSpy = jest.spyOn(global, "fetch").mockReturnValue(upstream);
		const server = await new Promise<http.Server>((resolve, reject) => {
			const listening = buildApp().listen(0, "127.0.0.1", () => resolve(listening));
			listening.once("error", reject);
		});
		let client: http.ClientRequest | undefined;
		let upstreamSettled = false;

		try {
			const port = (server.address() as AddressInfo).port;
			let responseStatus: number | undefined;
			let responseHeaders: http.IncomingHttpHeaders = {};
			const chunks: Buffer[] = [];
			let resolveFirstChunk!: (chunk: string) => void;
			const firstChunk = new Promise<string>((resolve) => {
				resolveFirstChunk = resolve;
			});
			const completed = new Promise<string>((resolve, reject) => {
				client = http.request(
					{
						host: "127.0.0.1",
						port: port,
						path: "/v1/responses",
						method: "POST",
						headers: { "content-type": "application/json" },
					},
					(response) => {
						responseStatus = response.statusCode;
						responseHeaders = response.headers;
						response.on("data", (chunk: Buffer) => {
							chunks.push(chunk);
							if (chunks.length === 1) {
								resolveFirstChunk(chunk.toString("utf8"));
							}
						});
						response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
					},
				);
				client.once("error", reject);
				client.end(JSON.stringify({ model: "gpt-5.6-sol", input: "hello", stream: true }));
			});

			const initialChunk = await firstChunk;
			expect(initialChunk.startsWith("event: ping\ndata: ")).toBe(true);
			expect(initialChunk.endsWith("\n\n")).toBe(true);
			const dataLine = initialChunk.split("\n").find((line) => line.startsWith("data: "));
			expect(dataLine).toBeDefined();
			expect(JSON.parse((dataLine ?? "").slice("data: ".length))).toMatchObject({ type: "ping" });
			expect(Buffer.byteLength(initialChunk)).toBeGreaterThanOrEqual(4_096);
			expect(responseStatus).toBe(200);
			expect(responseHeaders["content-type"]).toContain("text/event-stream");
			expect(responseHeaders["x-accel-buffering"]).toBe("no");
			expect(fetchSpy).toHaveBeenCalledTimes(1);

			upstreamSettled = true;
			resolveUpstream(
				new Response('event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1"}}\n\n', {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				}),
			);
			await expect(completed).resolves.toContain("event: response.completed");
		} finally {
			client?.destroy();
			if (!upstreamSettled) {
				resolveUpstream(new Response(null, { status: 204 }));
			}
			await closeServer(server);
		}
	});

	it("finishes reading a terminal already in flight after the client closes on the final text delta", async () => {
		const encoder = new TextEncoder();
		const outputTextDeltaEvent =
			'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"hello"}\n\n';
		const outputTextDoneEvent =
			'event: response.output_text.done\ndata: {"type":"response.output_text.done","item_id":"msg_1","output_index":0,"content_index":0,"text":"hello"}\n\n';
		const outputItemDoneEvent =
			'event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"id":"msg_1","type":"message","status":"completed","role":"assistant","content":[]}}\n\n';
		const terminalEvent =
			'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":3,"output_tokens":5}}}\n\n';
		let releaseTerminal!: () => void;
		const terminalReady = new Promise<void>((resolve) => {
			releaseTerminal = resolve;
		});
		let terminalReleased = false;
		let upstreamAborted = false;
		jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
			const body = new ReadableStream<Uint8Array>({
				start: (controller) => {
					controller.enqueue(encoder.encode(outputTextDeltaEvent));
					init?.signal?.addEventListener(
						"abort",
						() => {
							upstreamAborted = true;
							controller.error(new DOMException("This operation was aborted", "AbortError"));
						},
						{ once: true },
					);
					void terminalReady.then(() => {
						if (!upstreamAborted) {
							controller.enqueue(encoder.encode(outputTextDoneEvent + outputItemDoneEvent + terminalEvent));
							controller.close();
						}
					});
				},
			});
			return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
		});

		const app = express();
		app.use(express.json());
		app.use((req, _res, next) => {
			req.auth = { api_key: "test-key", models: ["gpt-5.6-sol"] } as never;
			next();
		});
		const deployment: Deployment = {
			model_name: "gpt-5.6-sol",
			litellm_params: { model: "cliproxy/gpt-5.6-sol", custom_llm_provider: "cliproxy" },
		};
		const router = {
			getAvailableDeployment: () => ({ deployment: deployment }),
			getDeployments: () => [deployment],
			getFallbacks: () => ({}),
			recordDeploymentSuccess: jest.fn(),
			recordDeploymentFailure: jest.fn(),
		} as unknown as LiteLLMRouter;
		const expressRouter = express.Router();
		registerCliProxyNativeResponsesRoutes(
			expressRouter,
			router,
			{ baseUrl: "http://127.0.0.1:8317", internalApiKey: "internal-only" } as CliProxyRuntimeManager,
			undefined as never,
		);
		app.use(expressRouter);
		const server = await new Promise<http.Server>((resolve, reject) => {
			const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
			listening.once("error", reject);
		});
		let client: http.ClientRequest | undefined;

		try {
			const port = (server.address() as AddressInfo).port;
			await new Promise<void>((resolve, reject) => {
				client = http.request(
					{
						host: "127.0.0.1",
						port: port,
						path: "/v1/responses",
						method: "POST",
						headers: { "content-type": "application/json" },
					},
					(response) => {
						let received = "";
						response.on("data", (chunk: Buffer) => {
							received += chunk.toString("utf8");
							if (received.includes("event: response.output_text.delta")) {
								response.destroy();
								resolve();
							}
						});
					},
				);
				client.once("error", reject);
				client.end(JSON.stringify({ model: "gpt-5.6-sol", input: "hello", stream: true }));
			});
			// The old 250 ms grace aborted this exact race before the terminal arrived.
			await new Promise((resolve) => setTimeout(resolve, 350));
			expect(upstreamAborted).toBe(false);
			terminalReleased = true;
			releaseTerminal();

			for (let attempt = 0; attempt < 20 && mockBuildSpendLogFromRequest.mock.calls.length === 0; attempt++) {
				await new Promise<void>((resolve) => setImmediate(resolve));
			}
			expect(mockBuildSpendLogFromRequest).toHaveBeenCalledTimes(1);
			const spendContext = mockBuildSpendLogFromRequest.mock.calls[0]?.[0] as {
				status?: string;
				response?: Record<string, unknown>;
				usage?: Record<string, unknown>;
				metadataOverrides?: Record<string, unknown>;
			};
			expect(spendContext).toMatchObject({
				status: "success",
				response: { id: "resp_1", status: "completed" },
				usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
				metadataOverrides: {
					responses_execution: {
						state: "completed",
						cancel_strategy: "text_terminal_tail_grace",
						upstream_abort_issued: false,
						terminal_received: true,
						terminal_received_at: expect.any(String),
						last_sse_event_at: expect.any(String),
					},
				},
			});
		} finally {
			client?.destroy();
			if (!terminalReleased) {
				releaseTerminal();
			}
			await closeServer(server);
		}
	});

	it("aborts unfinished upstream work after client disconnect and logs the accumulated partial response", async () => {
		const encoder = new TextEncoder();
		const partialEvents =
			'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_partial","status":"in_progress","output":[]}}\n\n' +
			'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","item_id":"msg_1","delta":"hel"}\n\n' +
			'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","item_id":"msg_1","delta":"lo"}\n\n';
		let upstreamAborted = false;
		jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
			const body = new ReadableStream<Uint8Array>({
				start: (controller) => {
					controller.enqueue(encoder.encode(partialEvents));
					init?.signal?.addEventListener(
						"abort",
						() => {
							upstreamAborted = true;
							controller.error(new DOMException("This operation was aborted", "AbortError"));
						},
						{ once: true },
					);
				},
			});
			return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
		});

		const app = express();
		app.use(express.json());
		app.use((req, _res, next) => {
			req.auth = { api_key: "test-key", models: ["gpt-5.6-sol"] } as never;
			next();
		});
		const deployment: Deployment = {
			model_name: "gpt-5.6-sol",
			litellm_params: { model: "cliproxy/gpt-5.6-sol", custom_llm_provider: "cliproxy" },
		};
		const router = {
			getAvailableDeployment: () => ({ deployment: deployment }),
			getDeployments: () => [deployment],
			getFallbacks: () => ({}),
			recordDeploymentSuccess: jest.fn(),
			recordDeploymentFailure: jest.fn(),
		} as unknown as LiteLLMRouter;
		const expressRouter = express.Router();
		registerCliProxyNativeResponsesRoutes(
			expressRouter,
			router,
			{ baseUrl: "http://127.0.0.1:8317", internalApiKey: "internal-only" } as CliProxyRuntimeManager,
			undefined as never,
		);
		app.use(expressRouter);
		const server = await new Promise<http.Server>((resolve, reject) => {
			const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
			listening.once("error", reject);
		});
		let client: http.ClientRequest | undefined;

		try {
			const port = (server.address() as AddressInfo).port;
			await new Promise<void>((resolve, reject) => {
				client = http.request(
					{
						host: "127.0.0.1",
						port: port,
						path: "/v1/responses",
						method: "POST",
						headers: { "content-type": "application/json" },
					},
					(response) => {
						let received = "";
						response.on("data", (chunk: Buffer) => {
							received += chunk.toString("utf8");
							if (received.includes('"delta":"lo"')) {
								response.destroy();
								resolve();
							}
						});
					},
				);
				client.once("error", reject);
				client.end(JSON.stringify({ model: "gpt-5.6-sol", input: "hello", stream: true }));
			});

			await new Promise((resolve) => setTimeout(resolve, 1_650));
			for (let attempt = 0; attempt < 40 && mockBuildSpendLogFromRequest.mock.calls.length === 0; attempt++) {
				await new Promise<void>((resolve) => setImmediate(resolve));
			}
			expect(upstreamAborted).toBe(true);
			expect(mockBuildSpendLogFromRequest).toHaveBeenCalledTimes(1);
			const spendContext = mockBuildSpendLogFromRequest.mock.calls[0]?.[0] as {
				status?: string;
				modelGroup?: string;
				deploymentModel?: string;
				customLlmProvider?: string;
				response?: Record<string, unknown>;
				metadataOverrides?: Record<string, unknown>;
				error?: Error;
			};
			expect(spendContext).toMatchObject({
				status: "cancelled",
				modelGroup: "gpt-5.6-sol",
				deploymentModel: "cliproxy/gpt-5.6-sol",
				customLlmProvider: "cliproxy",
				response: {
					id: "resp_partial",
					status: "in_progress",
					partial_output_text: "hello",
					last_event: { type: "response.output_text.delta", delta: "lo" },
				},
				metadataOverrides: {
					responses_execution: {
						state: "client_cancelled",
						client_disconnected: true,
						cancel_requested: true,
						cancel_strategy: "text_terminal_tail_grace",
						cancel_source: "response_closed",
						client_disconnected_at: expect.any(String),
						upstream_abort_issued: true,
						upstream_abort_issued_at: expect.any(String),
						terminal_received: false,
						last_sse_event: "response.output_text.delta",
						last_sse_event_at: expect.any(String),
					},
				},
			});
			expect(spendContext.error).toMatchObject({
				name: "ClientDisconnected",
				message: "Client disconnected before the upstream response reached a terminal event (response_closed).",
			});
			expect(mockTrackSpendLog).toHaveBeenCalledTimes(1);
		} finally {
			client?.destroy();
			await closeServer(server);
		}
	});

	it("records upstream request and response context for native Responses passthrough", async () => {
		jest.spyOn(global, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ id: "resp_1", status: "completed", usage: { input_tokens: 3, output_tokens: 5 } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const app = express();
		app.use(express.json());
		app.use((req, _res, next) => {
			req.auth = { api_key: "test-key", models: ["gpt-5.6-sol"] } as never;
			next();
		});
		const deployment: Deployment = {
			model_name: "gpt-5.6-sol",
			litellm_params: { model: "cliproxy/gpt-5.6-sol", custom_llm_provider: "cliproxy" },
		};
		const router = {
			getAvailableDeployment: () => ({ deployment: deployment }),
			getDeployments: () => [deployment],
			getFallbacks: () => ({}),
			recordDeploymentSuccess: jest.fn(),
			recordDeploymentFailure: jest.fn(),
		} as unknown as LiteLLMRouter;
		const expressRouter = express.Router();
		registerCliProxyNativeResponsesRoutes(
			expressRouter,
			router,
			{ baseUrl: "http://127.0.0.1:8317", internalApiKey: "internal-only" } as CliProxyRuntimeManager,
			undefined as never,
		);
		app.use(expressRouter);

		await request(app).post("/v1/responses").send({ model: "gpt-5.6-sol", input: "hello" }).expect(200);
		await new Promise<void>((resolve) => setImmediate(resolve));

		expect(mockBuildSpendLogFromRequest).toHaveBeenCalledTimes(1);
		const spendContext = mockBuildSpendLogFromRequest.mock.calls[0]?.[0] as {
			upstreamLogContext?: {
				request: { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> };
				response?: { status_code: number; body?: Record<string, unknown> };
			};
		};
		expect(spendContext.upstreamLogContext).toMatchObject({
			request: {
				url: "http://127.0.0.1:8317/v1/responses",
				method: "POST",
				headers: { authorization: "Bearer internal-only" },
				body: { model: "gpt-5.6-sol", input: "hello" },
			},
			response: { status_code: 200, body: { id: "resp_1", status: "completed" } },
		});
	});

	it("records request-only upstream context when CLIProxy fetch fails", async () => {
		jest.spyOn(global, "fetch").mockRejectedValue(new Error("connect ECONNREFUSED"));
		const app = express();
		app.use(express.json());
		app.use((req, _res, next) => {
			req.auth = { api_key: "test-key", models: ["gpt-5.6-sol"] } as never;
			next();
		});
		const deployment: Deployment = {
			model_name: "gpt-5.6-sol",
			litellm_params: { model: "cliproxy/gpt-5.6-sol", custom_llm_provider: "cliproxy" },
		};
		const router = {
			getAvailableDeployment: () => ({ deployment: deployment }),
			getDeployments: () => [deployment],
			getFallbacks: () => ({}),
			recordDeploymentSuccess: jest.fn(),
			recordDeploymentFailure: jest.fn(),
		} as unknown as LiteLLMRouter;
		const expressRouter = express.Router();
		registerCliProxyNativeResponsesRoutes(
			expressRouter,
			router,
			{ baseUrl: "http://127.0.0.1:8317", internalApiKey: "internal-only" } as CliProxyRuntimeManager,
			undefined as never,
		);
		app.use(expressRouter);

		await request(app).post("/v1/responses").send({ model: "gpt-5.6-sol", input: "hello" }).expect(500);
		await new Promise<void>((resolve) => setImmediate(resolve));

		expect(mockBuildSpendLogFromRequest).toHaveBeenCalledTimes(1);
		const spendContext = mockBuildSpendLogFromRequest.mock.calls[0]?.[0] as {
			upstreamLogContext?: {
				request: { url: string; method: string };
				response?: { status_code: number };
			};
		};
		expect(spendContext.upstreamLogContext?.request).toMatchObject({
			url: "http://127.0.0.1:8317/v1/responses",
			method: "POST",
		});
		expect(spendContext.upstreamLogContext?.response).toBeUndefined();
	});

	it("overrides the final native Responses reasoning effort", async () => {
		const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ id: "resp_1", usage: { input_tokens: 1, output_tokens: 1 } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);

		await request(buildApp("max"))
			.post("/v1/responses")
			.send({
				model: "gpt-5.6-sol",
				input: "hello",
				reasoning: { effort: "low", summary: "detailed" },
			})
			.expect(200);

		const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
		expect(JSON.parse(String(init?.body))).toMatchObject({
			model: "gpt-5.6-sol",
			reasoning: { effort: "max", summary: "detailed" },
		});
	});

	it("forwards Anthropic SSE before logging and records the accumulated response with upstream context", async () => {
		const encoder = new TextEncoder();
		const events = [
			'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"gpt-5.6-sol","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":282,"output_tokens":0,"cache_read_input_tokens":1000,"cache_creation_input_tokens":10}}}\n\n',
			'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n',
			'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
			'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":123}}\n\n',
			'event: message_stop\ndata: {"type":"message_stop"}\n\n',
		];
		let releaseRemainingEvents!: () => void;
		const remainingEvents = new Promise<void>((resolve) => {
			releaseRemainingEvents = resolve;
		});
		let released = false;
		const upstreamBody = new ReadableStream<Uint8Array>({
			start: function (controller) {
				controller.enqueue(encoder.encode(events[0]));
				void remainingEvents.then(() => {
					for (const event of events.slice(1)) {
						controller.enqueue(encoder.encode(event));
					}
					controller.close();
				});
			},
		});
		jest.spyOn(global, "fetch").mockResolvedValue(
			new Response(upstreamBody, { status: 200, headers: { "content-type": "text/event-stream" } }),
		);
		const server = await new Promise<http.Server>((resolve, reject) => {
			const listening = buildAnthropicApp().listen(0, "127.0.0.1", () => resolve(listening));
			listening.once("error", reject);
		});
		let client: http.ClientRequest | undefined;

		try {
			const port = (server.address() as AddressInfo).port;
			const chunks: Buffer[] = [];
			let resolveFirstChunk!: (chunk: string) => void;
			const firstChunk = new Promise<string>((resolve) => {
				resolveFirstChunk = resolve;
			});
			const completed = new Promise<string>((resolve, reject) => {
				client = http.request(
					{
						host: "127.0.0.1",
						port: port,
						path: "/v1/messages",
						method: "POST",
						headers: { "content-type": "application/json" },
					},
					(response) => {
						response.on("data", (chunk: Buffer) => {
							chunks.push(chunk);
							if (chunks.length === 1) {
								resolveFirstChunk(chunk.toString("utf8"));
							}
						});
						response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
					},
				);
				client.once("error", reject);
				client.end(JSON.stringify({ model: "gpt-5.6-sol", messages: [{ role: "user", content: "hello" }], stream: true }));
			});

			await expect(firstChunk).resolves.toBe(events[0]);
			expect(mockBuildSpendLogFromRequest).not.toHaveBeenCalled();
			released = true;
			releaseRemainingEvents();
			await expect(completed).resolves.toBe(events.join(""));
			await new Promise<void>((resolve) => setImmediate(resolve));

			expect(mockBuildSpendLogFromRequest).toHaveBeenCalledTimes(1);
			const spendContext = mockBuildSpendLogFromRequest.mock.calls[0]?.[0] as {
				proxyServerRequestBody?: unknown;
				response?: Record<string, unknown>;
				usage?: Record<string, unknown>;
				upstreamLogContext?: {
					request: { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> };
					response?: { status_code: number; body?: Record<string, unknown> };
				};
			};
			expect(spendContext.proxyServerRequestBody).toMatchObject({ model: "gpt-5.6-sol", stream: true });
			expect(spendContext.response).toMatchObject({
				id: "msg_1",
				type: "message",
				content: [{ type: "text", text: "hello" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 282, output_tokens: 123 },
			});
			// PY transformation.py:1587-1611：Anthropic input_tokens 不含 cache，折叠进 prompt_tokens
			expect(spendContext.usage).toMatchObject({
				prompt_tokens: 282 + 1000 + 10,
				completion_tokens: 123,
				total_tokens: 282 + 1000 + 10 + 123,
				cache_read_input_tokens: 1000,
				cache_creation_input_tokens: 10,
			});
			expect(spendContext.upstreamLogContext).toMatchObject({
				request: {
					url: "http://127.0.0.1:8317/v1/messages",
					method: "POST",
					headers: { authorization: "Bearer internal-only", "x-api-key": "internal-only" },
					body: { model: "gpt-5.6-sol", stream: true },
				},
				response: {
					status_code: 200,
					body: { id: "msg_1", type: "message", content: [{ type: "text", text: "hello" }] },
				},
			});
			expect(mockTrackSpendLog).toHaveBeenCalledTimes(1);
		} finally {
			client?.destroy();
			if (!released) {
				releaseRemainingEvents();
			}
			await closeServer(server);
		}
	});

	it.each([
		["/v1/chat/completions", true],
		["/chat/completions", false],
	] as const)("records complete Chat output from deltas at %s (usage-only tail: %s)", async (path, usageOnlyTail) => {
		const chunk = (choices: unknown[], extra = {}) => ({
			id: "chat_log",
			object: "chat.completion.chunk",
			model: "gpt-5.6-sol",
			created: 123,
			choices,
			...extra,
		});
		const usage = { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 };
		const events =
			[
				chunk([{ index: 0, delta: { role: "assistant", reasoning_content: "Think " } }]),
				chunk([{ index: 0, delta: { reasoning_content: "first", content: "Hello " } }]),
				chunk([{ index: 0, delta: { content: "世界" }, finish_reason: "stop", native_finish_reason: "stop" }]),
				chunk([
					{
						index: 1,
						delta: {
							role: "assistant",
							tool_calls: [
								{ index: 1, id: "call_b", type: "function", function: { name: "second", arguments: '{"b":' } },
								{ index: 0, id: "call_a", type: "function", function: { name: "read_", arguments: '{"a":' } },
							],
						},
					},
				]),
				chunk([
					{
						index: 1,
						delta: {
							tool_calls: [
								{ index: 0, function: { name: "file", arguments: "1}" } },
								{ index: 1, function: { arguments: "2}" } },
							],
						},
					},
				]),
				chunk([{ index: 1, delta: {}, finish_reason: "tool_calls" }]),
				chunk([], { usage, service_tier: "default" }),
			]
				.map((value) => `data: ${JSON.stringify(value)}\r\n\r\n`)
				.join("") + "data: [DONE]\r\n\r\n";
		jest.spyOn(global, "fetch").mockResolvedValue(
			new Response(events, {
				headers: { "content-type": "text/event-stream" },
			}),
		);
		const result = await request(buildApp(undefined, true))
			.post(path)
			.send({ model: "gpt-5.6-sol", messages: [{ role: "user", content: "hello" }], stream: true })
			.expect(200);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(result.text).toBe(events);
		expect(mockBuildSpendLogFromRequest).toHaveBeenCalledTimes(1);
		const context = mockBuildSpendLogFromRequest.mock.calls[0]?.[0] as {
			response: unknown;
			usage: unknown;
			upstreamLogContext: { response: { body: unknown } };
		};
		expect(context.response).toMatchObject({
			id: "chat_log",
			object: "chat.completion",
			usage,
			service_tier: "default",
			choices: [
				{
					index: 0,
					finish_reason: "stop",
					native_finish_reason: "stop",
					message: {
						role: "assistant",
						content: "Hello 世界",
						reasoning_content: "Think first",
					},
				},
				{
					index: 1,
					finish_reason: "tool_calls",
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{ id: "call_a", type: "function", function: { name: "read_file", arguments: '{"a":1}' } },
							{ id: "call_b", type: "function", function: { name: "second", arguments: '{"b":2}' } },
						],
					},
				},
			],
		});
		expect(context.usage).toMatchObject(usage);
		expect(context.upstreamLogContext.response.body).toEqual(context.response);
		expect(mockTrackSpendLog).toHaveBeenCalledTimes(1);
	});

	it.each([false, true])("keeps a native JSON Chat response intact (stream requested: %s)", async (stream) => {
		const body = {
			id: "chat_json",
			object: "chat.completion",
			model: "gpt-5.6-sol",
			choices: [{ index: 0, message: { role: "assistant", content: "A complete answer" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
		};
		jest.spyOn(global, "fetch").mockResolvedValue(
			new Response(JSON.stringify(body), {
				headers: { "content-type": "application/json" },
			}),
		);
		const result = await request(buildApp(undefined, true))
			.post("/v1/chat/completions")
			.send({ model: "gpt-5.6-sol", messages: [{ role: "user", content: "hello" }], stream })
			.expect(200);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(result.body).toEqual(body);
		expect(mockBuildSpendLogFromRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				response: body,
				usage: body.usage,
			}),
		);
	});

	it("falls back before forwarding an Anthropic upstream 403 response", async () => {
		const primary: Deployment = {
			model_name: "k3",
			litellm_params: { model: "cliproxy/kimi-k3", custom_llm_provider: "cliproxy" },
			model_info: { id: "k3-deployment" },
		};
		const fallback: Deployment = {
			model_name: "gpt-5.6-sol",
			litellm_params: { model: "cliproxy/gpt-5.6-sol", custom_llm_provider: "cliproxy" },
			model_info: { id: "sol-deployment" },
		};
		const provider = new CliProxyProvider("internal-only", "http://127.0.0.1:8317");
		const recordDeploymentFailure = jest.fn();
		const recordDeploymentSuccess = jest.fn();
		const router = {
			getAvailableDeployment: (model: string) => {
				if (model === "k3") {
					return { deployment: primary, provider: provider };
				}
				if (model === "gpt-5.6-sol") {
					return { deployment: fallback, provider: provider };
				}
				return null;
			},
			getDeployments: () => [primary, fallback],
			getFallbacks: () => ({ k3: ["gpt-5.6-sol"] }),
			getNextFallback: (model: string) => (model === "k3" ? "gpt-5.6-sol" : null),
			hasModel: (model: string) => model === "k3" || model === "gpt-5.6-sol",
			getNoAvailableDeploymentInfo: () => ({}),
			maxFallbacks: 5,
			recordDeploymentSuccess: recordDeploymentSuccess,
			recordDeploymentFailure: recordDeploymentFailure,
		} as unknown as LiteLLMRouter;
		const upstreamEvents =
			'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_fb","type":"message","role":"assistant","model":"gpt-5.6-sol","content":[],"usage":{"input_tokens":3,"output_tokens":0}}}\n\n' +
			'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"fallback ok"}}\n\n' +
			'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n' +
			'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n' +
			'event: message_stop\ndata: {"type":"message_stop"}\n\n';
		const fetchSpy = jest
			.spyOn(global, "fetch")
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						type: "error",
						error: { type: "permission_error", message: "usage limit for this billing cycle" },
					}),
					{ status: 403, headers: { "content-type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(new Response(upstreamEvents, { status: 200, headers: { "content-type": "text/event-stream" } }));

		const response = await request(buildAnthropicApp(router))
			.post("/v1/messages")
			.send({ model: "k3", messages: [{ role: "user", content: "hello" }], stream: true })
			.expect(200);
		await new Promise<void>((resolve) => setImmediate(resolve));

		expect(response.text).toBe(upstreamEvents);
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toMatchObject({ model: "kimi-k3" });
		expect(JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body))).toMatchObject({ model: "gpt-5.6-sol" });
		expect(recordDeploymentFailure).toHaveBeenCalledWith(primary, expect.objectContaining({ status: 403 }));
		expect(recordDeploymentSuccess).toHaveBeenCalledWith(fallback);
		const spendContext = mockBuildSpendLogFromRequest.mock.calls[0]?.[0] as {
			attemptedRetries?: number;
			fallbackModels?: string[];
			routingTrace?: Array<Record<string, unknown>>;
			modelId?: string;
			status?: SpendLogStatus;
		};
		expect(spendContext).toMatchObject({
			attemptedRetries: 1,
			fallbackModels: ["k3", "gpt-5.6-sol"],
			modelId: "sol-deployment",
			status: SpendLogStatus.Success,
		});
		expect(spendContext.routingTrace).toEqual([
			expect.objectContaining({ from_model: "k3", to_model: "gpt-5.6-sol", routing_type: "general_fallback" }),
		]);
	});
});

describe("Codex parameters at native upstream boundaries", () => {
	afterEach(() => jest.restoreAllMocks());
	it.each(["/v1/responses", "/v1/chat/completions", "/v1/messages"])(
		"keeps gateway drop_params out of %s while retaining native fields",
		async (path) => {
			const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
				const body = JSON.parse(String(init?.body));
				return "drop_params" in body
					? new Response(JSON.stringify({ detail: "Unsupported parameter: drop_params" }), {
							status: 400,
							headers: { "content-type": "application/json" },
						})
					: new Response(JSON.stringify({ id: "test-native", usage: { input_tokens: 1, output_tokens: 1 } }), {
							status: 200,
							headers: { "content-type": "application/json" },
						});
			});
			const body = {
				model: "gpt-5.6-sol",
				max_output_tokens: 32,
				store: false,
				...(path === "/v1/responses" ? { input: "hello" } : { messages: [{ role: "user", content: "hello" }] }),
			};
			await request(path === "/v1/messages" ? buildAnthropicApp() : buildApp())
				.post(path)
				.set("User-Agent", "codex/test")
				.send(body)
				.expect(200);
			const forwarded = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
			expect(forwarded).not.toHaveProperty("drop_params");
			expect(forwarded).toMatchObject({ ...body, model: "gpt-5.6-sol" });
		},
	);
});

describe('CLIProxy native Responses route and builtin capabilities', () => {
	afterEach(() => {
		jest.restoreAllMocks();
		jest.clearAllMocks();
	});

	it('leaves models with builtin capabilities to the LiteLLM Responses endpoint', async () => {
		const deployment: Deployment = {
			model_name: 'opencode-go/deepseek-v4.1-flash',
			litellm_params: {
				model: 'cliproxy/opencode-go/deepseek-v4.1-flash',
				custom_llm_provider: 'cliproxy',
			},
			model_info: { enabled_builtin_capabilities: ['image_generation', 'web'] },
		};
		const router = {
			getAvailableDeployment: () => ({ deployment: deployment }),
			getDeployments: () => [deployment],
			resolveModelGroupWithTrace: (model: string) => ({ inputModel: model, resolvedModel: model, resolutionPath: [model] }),
			hasModel: () => true,
			getFallbacks: () => ({}),
			recordDeploymentSuccess: jest.fn(),
			recordDeploymentFailure: jest.fn(),
		} as unknown as LiteLLMRouter;
		const runtime = {
			baseUrl: 'http://127.0.0.1:8317',
			internalApiKey: 'internal-only',
		} as CliProxyRuntimeManager;
		const app = express();
		app.use(express.json());
		app.use(codingClientModelMiddleware(router));
		const expressRouter = express.Router();
		registerCliProxyNativeResponsesRoutes(expressRouter, router, runtime, undefined as never);
		app.use(expressRouter);

		await request(app)
			.post('/v1/responses')
			.send({ model: 'opencode-go/deepseek-v4.1-flash', input: 'hi', store: false })
			.expect(404);
	});
});

describe('CLIProxy native chat route and builtin capabilities', () => {
	afterEach(() => {
		jest.restoreAllMocks();
		jest.clearAllMocks();
	});

	async function postChat(router: LiteLLMRouter, path: string, payload: Record<string, unknown>): Promise<number> {
		const runtime = {
			baseUrl: 'http://127.0.0.1:8317',
			internalApiKey: 'internal-only',
		} as CliProxyRuntimeManager;
		const app = express();
		app.use(express.json());
		app.use(codingClientModelMiddleware(router));
		const expressRouter = express.Router();
		registerCliProxyNativeChatRoutes(expressRouter, router, runtime, undefined as never);
		app.use(expressRouter);
		const server = await new Promise<http.Server>((resolve) => {
			const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
		});
		try {
			const port = (server.address() as AddressInfo).port;
			return await new Promise<number>((resolve, reject) => {
				const req = http.request(
					{
						host: '127.0.0.1',
						port: port,
						path: path,
						method: 'POST',
						headers: { 'content-type': 'application/json' },
					},
					(response) => {
						response.resume();
						resolve(response.statusCode ?? 0);
					},
				);
				req.once('error', reject);
				req.end(JSON.stringify(payload));
			});
		} finally {
			await closeServer(server);
		}
	}

	/**
	 * 透传路由必须让出绑定了内置能力的模型，否则能力注入（web/vision 工具）会被静默跳过：
	 * 请求虽然 200，但模型收不到任何私有工具。这正是 web 能力在 cliproxy 模型上失效的原因。
	 */
	it.each(['/v1/chat/completions', '/chat/completions'])(
		'leaves models with builtin capabilities to the LiteLLM chat endpoint (%s)',
		async (path) => {
			const deployment: Deployment = {
				model_name: 'opencode-go/deepseek-v4.1-flash',
				litellm_params: {
					model: 'cliproxy/opencode-go/deepseek-v4.1-flash',
					custom_llm_provider: 'cliproxy',
				},
				model_info: { enabled_builtin_capabilities: ['image_generation', 'web'] },
			};
			const router = {
				getAvailableDeployment: () => ({ deployment: deployment }),
				getDeployments: () => [deployment],
				resolveModelGroupWithTrace: (model: string) => ({
					inputModel: model,
					resolvedModel: model,
					resolutionPath: [model],
				}),
				hasModel: () => true,
				getFallbacks: () => ({}),
				recordDeploymentSuccess: jest.fn(),
				recordDeploymentFailure: jest.fn(),
			} as unknown as LiteLLMRouter;

			// 未注册匹配 -> Express 落到 404，证明请求没有进入透传 handler。
			await expect(
				postChat(router, path, { model: 'opencode-go/deepseek-v4.1-flash', messages: [{ role: 'user', content: 'hi' }] }),
			).resolves.toBe(404);
		},
	);

	it('still passes through cliproxy models without builtin capabilities', async () => {
		const deployment: Deployment = {
			model_name: 'opencode-go/plain-model',
			litellm_params: {
				model: 'cliproxy/opencode-go/plain-model',
				custom_llm_provider: 'cliproxy',
			},
		};
		const router = {
			getAvailableDeployment: () => ({ deployment: deployment }),
			getDeployments: () => [deployment],
			resolveModelGroupWithTrace: (model: string) => ({ inputModel: model, resolvedModel: model, resolutionPath: [model] }),
			hasModel: () => true,
			getFallbacks: () => ({}),
			recordDeploymentSuccess: jest.fn(),
			recordDeploymentFailure: jest.fn(),
		} as unknown as LiteLLMRouter;

		// 有能力的模型才让出；无能力模型仍由透传接管（不会 404）。
		const status = await postChat(router, '/v1/chat/completions', {
			model: 'opencode-go/plain-model',
			messages: [{ role: 'user', content: 'hi' }],
		});
		expect(status).not.toBe(404);
	});
});

describe('CLIProxy native Anthropic route and builtin capabilities', () => {
	afterEach(() => {
		jest.restoreAllMocks();
		jest.clearAllMocks();
	});

	async function postMessages(router: LiteLLMRouter, payload: Record<string, unknown>): Promise<number> {
		const runtime = {
			baseUrl: 'http://127.0.0.1:8317',
			internalApiKey: 'internal-only',
		} as CliProxyRuntimeManager;
		const app = express();
		app.use(express.json());
		app.use(codingClientModelMiddleware(router));
		const expressRouter = express.Router();
		registerCliProxyNativeAnthropicRoutes(expressRouter, router, runtime, undefined as never);
		app.use(expressRouter);
		const server = await new Promise<http.Server>((resolve) => {
			const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
		});
		try {
			const port = (server.address() as AddressInfo).port;
			return await new Promise<number>((resolve, reject) => {
				const req = http.request(
					{
						host: '127.0.0.1',
						port: port,
						path: '/v1/messages',
						method: 'POST',
						headers: { 'content-type': 'application/json' },
					},
					(response) => {
						response.resume();
						resolve(response.statusCode ?? 0);
					},
				);
				req.once('error', reject);
				req.end(JSON.stringify(payload));
			});
		} finally {
			await closeServer(server);
		}
	}

	it('leaves models with builtin capabilities to the LiteLLM Messages endpoint', async () => {
		const deployment: Deployment = {
			model_name: 'opencode-go/deepseek-v4.1-flash',
			litellm_params: {
				model: 'cliproxy/opencode-go/deepseek-v4.1-flash',
				custom_llm_provider: 'cliproxy',
			},
			model_info: { enabled_builtin_capabilities: ['web'] },
		};
		const router = {
			getAvailableDeployment: () => ({ deployment: deployment }),
			getDeployments: () => [deployment],
			resolveModelGroupWithTrace: (model: string) => ({ inputModel: model, resolvedModel: model, resolutionPath: [model] }),
			hasModel: () => true,
			getFallbacks: () => ({}),
			recordDeploymentSuccess: jest.fn(),
			recordDeploymentFailure: jest.fn(),
		} as unknown as LiteLLMRouter;

		const status = await postMessages(router, {
			model: 'opencode-go/deepseek-v4.1-flash',
			max_tokens: 16,
			messages: [{ role: 'user', content: 'hi' }],
		});

		expect(status).toBe(404);
	});

});
