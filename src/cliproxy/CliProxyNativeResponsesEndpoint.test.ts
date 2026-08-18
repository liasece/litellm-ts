import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import type { Router as LiteLLMRouter } from "../router/Router";
import type { Deployment } from "../types/router";
import type { CliProxyRuntimeManager } from "./CliProxyRuntimeManager";
import { registerCliProxyNativeAnthropicRoutes, registerCliProxyNativeResponsesRoutes } from "./CliProxyNativeResponsesEndpoint";

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

function buildApp(reasoningEffortOverride?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max"): express.Express {
	const deployment: Deployment = {
		model_name: "gpt-5.6-sol",
		litellm_params: {
			model: "cliproxy/gpt-5.6-sol",
			custom_llm_provider: "cliproxy",
		},
		model_info: reasoningEffortOverride ? { override_reasoning_effort: reasoningEffortOverride } : undefined,
	};
	const router = {
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
	const expressRouter = express.Router();
	registerCliProxyNativeResponsesRoutes(expressRouter, router, runtime, undefined as never);
	app.use(expressRouter);
	return app;
}

function buildAnthropicApp(): express.Express {
	const deployment: Deployment = {
		model_name: "gpt-5.6-sol",
		litellm_params: {
			model: "cliproxy/gpt-5.6-sol",
			custom_llm_provider: "cliproxy",
		},
	};
	const router = {
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
	app.use((req, _res, next) => {
		req.auth = { api_key: "test-key", models: ["gpt-5.6-sol"] };
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
});
