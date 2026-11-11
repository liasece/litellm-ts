import express from "express";
import request from "supertest";
import { registerSubscriptionSpecialRoutes } from "./SubscriptionSpecialEndpoints";
import { SubscriptionBridge } from "./bridge";
import { SubscriptionAccountScheduler } from "./scheduler";
import { setSubscriptionRequestHandler } from "../../router/SubscriptionDispatch";
import type { SubscriptionAccount, SubscriptionProviderAdapter } from "./types";

const ACCOUNT: SubscriptionAccount = {
	id: "xai-1",
	source: "xai",
	fileName: "xai-test.json",
	path: "/tmp/xai-test.json",
	disabled: false,
	weight: 1,
	raw: { type: "xai", access_token: "token" },
};

const DEPLOYMENT = {
	model_name: "grok-imagine-video",
	litellm_params: { model: "xai-subscription/grok-imagine-video", custom_llm_provider: "xai-subscription" },
	model_info: { id: "dep-xai-video" },
};

function adapter(): SubscriptionProviderAdapter {
	return {
		source: "xai",
		displayName: "xAI",
		auth: {
			source: "xai",
			ensureCredential: async () => "token",
			refresh: async () => undefined,
		},
		supports: () => true,
		route: () => "responses",
		resolveModel: (model) => model,
		build: async (context) => ({
			url: `https://upstream.test/videos/${encodeURIComponent(String(context.body["request_id"]))}`,
			method: "GET",
			headers: { "Content-Type": "application/json" },
			body: context.body,
			model: context.model,
			stream: false,
			protocol: "responses",
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
			get: (source) => (source === "xai" ? provider : undefined),
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

it("GET /v1/videos/:id 把 xAI 任务映射为 OpenAI Videos 形状", async () => {
	jest.spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(
			JSON.stringify({
				status: "completed",
				model: "grok-imagine-video",
				video: { url: "https://cdn.test/video.mp4", duration: 6 },
				progress: 100,
				created_at: 1700000000,
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		),
	);
	const response = await request(buildApp()).get("/v1/videos/req%201");
	expect(response.status).toBe(200);
	expect(response.body).toMatchObject({
		object: "video",
		id: "req 1",
		model: "grok-imagine-video",
		status: "completed",
		seconds: "6",
		video_url: "https://cdn.test/video.mp4",
	});
});

it("GET /v1/videos/:id/content 下载并流式返回视频字节", async () => {
	const fetched: string[] = [];
	jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
		const url = String(input);
		fetched.push(url);
		if (url.includes("upstream.test")) {
			return new Response(JSON.stringify({ status: "completed", video: { url: "https://cdn.test/video.mp4" } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		return new Response(Buffer.from([1, 2, 3, 4]), { status: 200, headers: { "content-type": "video/mp4" } });
	});
	const response = await request(buildApp()).get("/v1/videos/req-1/content");
	expect(response.status).toBe(200);
	expect(response.headers["content-type"]).toBe("video/mp4");
	expect(Buffer.from(response.body).equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
	expect(fetched.some((url) => url === "https://cdn.test/video.mp4")).toBe(true);
});
