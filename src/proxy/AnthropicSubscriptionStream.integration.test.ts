import express from "express";
import request from "supertest";
import { registerAnthropicMessagesEndpoints } from "./AnthropicMessagesEndpoint";
import { SubscriptionBridge, subscriptionBridgeUrl } from "../subscriptions/native/bridge";
import { SubscriptionAccountScheduler } from "../subscriptions/native/scheduler";
import { setSubscriptionRequestHandler } from "../router/SubscriptionDispatch";
import type { SubscriptionAccount, SubscriptionProviderAdapter } from "../subscriptions/native/types";

const runtimeConfig = { generalSettings: {} };

jest.mock("../core/config", () => ({ getConfig: () => runtimeConfig }));

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
			startLogin: async () => {
				throw new Error("not used");
			},
		},
		supports: () => true,
		route: () => "responses",
		resolveModel: (model) => model,
		build: async (context) => ({
			url: "https://upstream.test/responses",
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: context.upstreamBody,
			model: context.model,
			stream: true,
			protocol: "responses",
			aggregateSse: !context.stream,
		}),
		catalog: async () => [],
		quota: async () => ({ fetchedAt: new Date().toISOString() }),
	};
}

it("Messages 流式入口消费订阅桥返回的实时 SSE", async () => {
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
	const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
		const sse = [
			'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_1","model":"gpt-test","created_at":100}}',
			'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"OK"}',
			'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-test","status":"completed","usage":{"input_tokens":5,"output_tokens":1,"total_tokens":6}}}',
		].join("\n\n") + "\n\n";
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(sse));
				controller.close();
			},
		});
		return new Response(body, { status: 200 });
	});
	const deployment = {
		model_name: "native-group",
		litellm_params: { model: "codex-subscription/gpt-test", custom_llm_provider: "codex-subscription" },
		model_info: { id: "dep-native" },
	};
	const providerConfig = {
		transformAnthropicRequest: () => ({
			url: subscriptionBridgeUrl("codex", "messages"),
			method: "POST" as const,
			headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
			body: { model: "gpt-test" },
			model: "native-group",
			stream: true,
		}),
	};
	const router = {
		getDeployments: () => [deployment],
		getAvailableDeployment: () => ({ deployment, provider: providerConfig }),
		getNextFallback: () => null,
		resolveModelGroupWithTrace: (model: string) => ({ inputModel: model, resolvedModel: model, resolutionPath: [model] }),
		recordDeploymentSuccess: () => undefined,
		recordDeploymentFailure: () => undefined,
		hasModel: () => true,
		getNoAvailableDeploymentInfo: () => ({ cooldownSeconds: 60, cooldownList: [], preCallChecks: false }),
		maxFallbacks: 0,
	};
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.auth = { api_key: "sk-test", user_id: "user-1" } as never;
		next();
	});
	const expressRouter = express.Router();
	registerAnthropicMessagesEndpoints(expressRouter, router as never);
	app.use(expressRouter);
	try {
		const response = await request(app)
			.post("/v1/messages")
			.send({ model: "native-group", max_tokens: 24, stream: true, messages: [{ role: "user", content: "hello" }] });
		if (response.status !== 200) throw new Error(response.text);
		expect(response.status).toBe(200);
		expect(response.text).toContain("event: message_start");
		expect(response.text).toContain("event: message_stop");
		expect(response.text).not.toContain("event: error");
	} finally {
		setSubscriptionRequestHandler(undefined);
		fetchSpy.mockRestore();
	}
});
