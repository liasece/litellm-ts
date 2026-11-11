import express from "express";
import request from "supertest";
import { registerSubscriptionSpecialRoutes } from "./SubscriptionSpecialEndpoints";
import { SubscriptionBridge, subscriptionBridgeUrl } from "./bridge";
import { SubscriptionAccountScheduler } from "./scheduler";
import { setSubscriptionRequestHandler } from "../../router/SubscriptionDispatch";
import type { SubscriptionAccount, SubscriptionProviderAdapter } from "./types";

const ACCOUNT: SubscriptionAccount = {
	id: "account-1",
	source: "codex",
	fileName: "codex-test.json",
	path: "/tmp/codex-test.json",
	disabled: false,
	weight: 1,
	raw: { type: "codex", access_token: "token", account_id: "acct" },
};

function adapter(): SubscriptionProviderAdapter {
	return {
		source: "codex",
		displayName: "Codex",
		auth: {
			source: "codex",
			ensureCredential: async () => "token",
			refresh: async () => undefined,
		},
		supports: () => true,
		route: () => "chat",
		countTokens: async () => 12,
		resolveModel: (model) => model,
		build: async (context) => ({
			url: "https://upstream.test/chat/completions",
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: context.upstreamBody,
			model: context.model,
			stream: context.stream,
			protocol: "chat",
		}),
		catalog: async () => [],
		quota: async () => ({ fetchedAt: new Date().toISOString() }),
	};
}

function buildApp(): express.Express {
	const provider = adapter();
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
	const deployment = {
		model_name: "client-model",
		litellm_params: { model: "codex-subscription/client-model", custom_llm_provider: "codex-subscription" },
		model_info: { id: "dep-native" },
	};
	const router = {
		getAvailableDeployment: () => ({ deployment, provider: {} }),
		recordDeploymentSuccess: () => undefined,
		recordDeploymentFailure: () => undefined,
	};
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.auth = { api_key: "sk-test", user_id: "user-1" } as never;
		next();
	});
	const expressRouter = express.Router();
	registerSubscriptionSpecialRoutes(expressRouter, router as never);
	app.use(expressRouter);
	return app;
}

afterEach(() => {
	setSubscriptionRequestHandler(undefined);
	jest.restoreAllMocks();
});

it("Gemini generateContent 经订阅桥返回 Gemini 响应", async () => {
	jest.spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(
			JSON.stringify({
				id: "chatcmpl-1",
				object: "chat.completion",
				model: "upstream-model",
				choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
				usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		),
	);
	const response = await request(buildApp())
		.post("/v1beta/models/client-model:generateContent")
		.send({ contents: [{ role: "user", parts: [{ text: "hi" }] }] });
	expect(response.status).toBe(200);
	expect(response.body["candidates"][0].content.parts[0].text).toBe("hello");
	expect(response.body["usageMetadata"].totalTokenCount).toBe(5);
});

it("Gemini countTokens 经订阅桥返回 totalTokens", async () => {
	const response = await request(buildApp())
		.post("/v1beta/models/client-model:countTokens")
		.send({ contents: [{ role: "user", parts: [{ text: "hi" }] }] });
	expect(response.status).toBe(200);
	expect(response.body).toEqual({ totalTokens: 12 });
});

it("Gemini streamGenerateContent 输出无 event 名的 SSE candidates", async () => {
	const upstream =
		[
			'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"upstream-model","choices":[{"index":0,"delta":{"role":"assistant","content":"hi"}}]}',
			'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"upstream-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}',
		].join("\n\n") + "\n\n";
	jest.spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(upstream, { status: 200, headers: { "content-type": "text/event-stream" } }),
	);
	const response = await request(buildApp())
		.post("/v1beta/models/client-model:streamGenerateContent?alt=sse")
		.send({ contents: [{ role: "user", parts: [{ text: "hi" }] }] });
	expect(response.status).toBe(200);
	expect(response.headers["content-type"]).toContain("text/event-stream");
	expect(response.text).not.toContain("event:");
	expect(response.text).toContain("data: ");
	expect(response.text).toContain('"candidates"');
	expect(response.text).toContain('"text":"hi"');
});
