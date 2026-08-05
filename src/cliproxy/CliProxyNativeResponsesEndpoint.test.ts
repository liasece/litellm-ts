import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import type { Router as LiteLLMRouter } from "../router/Router";
import type { Deployment } from "../types/router";
import type { CliProxyRuntimeManager } from "./CliProxyRuntimeManager";
import { registerCliProxyNativeResponsesRoutes } from "./CliProxyNativeResponsesEndpoint";

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

async function closeServer(server: http.Server): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

describe("CLIProxy native Responses streaming", () => {
	afterEach(() => {
		jest.restoreAllMocks();
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
});
