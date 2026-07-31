import express from "express";
import request from "supertest";
import type { Router as LiteLLMRouter } from "../router/Router";
import type { Deployment } from "../types/router";
import type { CliProxyRuntimeManager } from "./CliProxyRuntimeManager";
import { registerCliProxyNativePassthroughRoutes } from "./CliProxyNativePassthroughEndpoint";

function buildApp(): express.Express {
	const deployments: Deployment[] = [
		{
			model_name: "public-image",
			litellm_params: {
				model: "cliproxy/gpt-image-2",
				custom_llm_provider: "cliproxy",
			},
		},
		{
			model_name: "public-gemini",
			litellm_params: {
				model: "cliproxy/gemini-3-pro",
				custom_llm_provider: "cliproxy",
			},
		},
		{
			model_name: "other-image",
			litellm_params: {
				model: "openai/gpt-image-1",
				custom_llm_provider: "openai",
			},
		},
	];
	const router = {
		getAvailableDeployment: (model: string) => {
			const deployment = deployments.find((item) => item.model_name === model);
			return deployment ? { deployment: deployment } : null;
		},
		getDeployments: () => deployments,
		recordDeploymentSuccess: jest.fn(),
		recordDeploymentFailure: jest.fn(),
		getFallbacks: () => ({}),
	} as unknown as LiteLLMRouter;
	const runtime = {
		baseUrl: "http://127.0.0.1:8317",
		internalApiKey: "internal-only",
	} as CliProxyRuntimeManager;
	const app = express();
	app.use(express.json());
	const expressRouter = express.Router();
	registerCliProxyNativePassthroughRoutes(expressRouter, router, runtime, undefined as never);
	expressRouter.post("/v1/images/generations", (_req, res) => res.json({ source: "fallback" }));
	app.use(expressRouter);
	return app;
}

describe("CLIProxy native passthrough", () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("lets image generation use the standard LiteLLM ImageController provider pipeline", async () => {
		const fetchSpy = jest.spyOn(global, "fetch");

		const response = await request(buildApp()).post("/v1/images/generations").send({ model: "public-image", prompt: "draw" });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ source: "fallback" });
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("keeps multipart file bytes while rewriting the model field", async () => {
		const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));

		const response = await request(buildApp())
			.post("/v1/images/edits")
			.field("model", "public-image")
			.field("prompt", "edit")
			.attach("image", Buffer.from([0, 1, 2, 3, 255]), {
				filename: "input.png",
				contentType: "image/png",
			});

		expect(response.status).toBe(200);
		const [, init] = fetchSpy.mock.calls[0]!;
		const forwarded = init?.body as Buffer;
		expect(forwarded).toBeInstanceOf(Buffer);
		expect(forwarded.includes(Buffer.from("gpt-image-2"))).toBe(true);
		expect(forwarded.includes(Buffer.from("public-image"))).toBe(false);
		expect(forwarded.includes(Buffer.from([0, 1, 2, 3, 255]))).toBe(true);
		expect(new Headers(init?.headers).get("content-type")).toContain("multipart/form-data");
	});

	it("rewrites Gemini path models and preserves the action query", async () => {
		const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ candidates: [] }), { status: 200 }));

		const response = await request(buildApp())
			.post("/v1beta/models/public-gemini:streamGenerateContent?alt=sse")
			.send({ contents: [{ role: "user", parts: [{ text: "hello" }] }] });

		expect(response.status).toBe(200);
		expect(fetchSpy.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8317/v1beta/models/gemini-3-pro:streamGenerateContent?alt=sse");
	});

	it("lists only configured CLIProxy Gemini aliases instead of leaking the child model catalog", async () => {
		jest.spyOn(global, "fetch").mockResolvedValue(
			Response.json({
				models: [
					{ name: "models/gemini-3-pro", supportedGenerationMethods: ["generateContent"] },
					{ name: "models/private-upstream-only", supportedGenerationMethods: ["generateContent"] },
				],
				nextPageToken: "upstream-page",
			}),
		);

		const response = await request(buildApp()).get("/v1beta/models");

		expect(response.status).toBe(200);
		expect(response.body).toEqual({
			models: [
				{
					name: "models/public-gemini",
					displayName: "public-gemini",
					baseModelId: "public-gemini",
					supportedGenerationMethods: ["generateContent"],
				},
			],
		});
	});

	it("lets non-CLIProxy image models continue to the existing LiteLLM endpoint", async () => {
		const fetchSpy = jest.spyOn(global, "fetch");

		const response = await request(buildApp()).post("/v1/images/generations").send({ model: "other-image", prompt: "draw" });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ source: "fallback" });
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("forwards stateful video retrieval without requiring a model in the request", async () => {
		const fetchSpy = jest
			.spyOn(global, "fetch")
			.mockResolvedValue(new Response(Buffer.from([1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } }));

		const response = await request(buildApp()).get("/openai/v1/videos/video-1/content");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain("video/mp4");
		expect(fetchSpy.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8317/openai/v1/videos/video-1/content");
	});
});
