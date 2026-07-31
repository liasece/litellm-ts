import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import WebSocket, { WebSocketServer } from "ws";
import type { ServiceContainer } from "../container";
import type { Deployment } from "../types/router";
import { registerCliProxyWebSocketPassthrough } from "./CliProxyWebSocketPassthrough";

async function listen(server: http.Server): Promise<number> {
	await new Promise<void>((resolve, reject) => {
		server.listen(0, "127.0.0.1", resolve);
		server.once("error", reject);
	});
	return (server.address() as AddressInfo).port;
}

async function close(server: http.Server): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

describe("CLIProxy WebSocket passthrough", () => {
	it("authenticates the upgrade and rewrites model fields before relaying frames", async () => {
		const upstreamHttp = http.createServer();
		const upstreamWss = new WebSocketServer({ server: upstreamHttp });
		const upstreamPort = await listen(upstreamHttp);
		const deployment: Deployment = {
			model_name: "public-codex",
			litellm_params: {
				model: "cliproxy/gpt-5.6-sol",
				custom_llm_provider: "cliproxy",
			},
		};
		let upstreamAuthorization: string | undefined;
		let upstreamMessage = "";
		const upstreamReceived = new Promise<void>((resolve) => {
			upstreamWss.on("connection", (socket, req) => {
				upstreamAuthorization = req.headers.authorization;
				socket.once("message", (data) => {
					upstreamMessage = data.toString();
					socket.send(JSON.stringify({ type: "response.completed" }));
					resolve();
				});
			});
		});
		const app = express();
		const gateway = http.createServer(app);
		const container = {
			authMiddleware: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
				req.auth = { api_key: "test", models: ["public-codex"] };
				next();
			},
			authorizationGuard: { middleware: () => (_req: unknown, _res: unknown, next: express.NextFunction) => next() },
			runtimeConfigService: { loadSnapshot: async () => ({}) },
			router: {
				getAvailableDeployment: (model: string) => (model === "public-codex" ? { deployment: deployment } : null),
				getDeployments: () => [deployment],
				runWithRuntimeSnapshot: (_snapshot: unknown, callback: () => void) => callback(),
			},
			cliProxyRuntime: {
				baseUrl: `http://127.0.0.1:${upstreamPort}`,
				internalApiKey: "internal-only",
			},
		} as unknown as ServiceContainer;
		registerCliProxyWebSocketPassthrough(gateway, container);
		const gatewayPort = await listen(gateway);
		const client = new WebSocket(`ws://127.0.0.1:${gatewayPort}/v1/responses`, {
			headers: { Authorization: "Bearer public-key" },
		});

		try {
			await new Promise<void>((resolve, reject) => {
				client.once("open", () => {
					client.send(
						JSON.stringify({
							type: "response.create",
							response: { model: "public-codex", input: "hello" },
						}),
					);
				});
				client.once("message", (data) => {
					expect(JSON.parse(data.toString())).toEqual({ type: "response.completed" });
					resolve();
				});
				client.once("error", reject);
			});
			await upstreamReceived;
			expect(upstreamAuthorization).toBe("Bearer internal-only");
			expect(JSON.parse(upstreamMessage)).toMatchObject({
				response: { model: "gpt-5.6-sol", input: "hello" },
			});
		} finally {
			client.terminate();
			for (const socket of upstreamWss.clients) {
				socket.terminate();
			}
			upstreamWss.close();
			await close(gateway);
			await close(upstreamHttp);
		}
	});
});
