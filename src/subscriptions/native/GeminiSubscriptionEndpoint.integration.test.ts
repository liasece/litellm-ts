import express from "express";
import request from "supertest";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { requestArrivalMiddleware } from "../../core/api/RequestArrival";
import type { DrizzleDb } from "../../core/db/Database";
import * as settlement from "../../spend/SpendSettlementQueue";
import type { SpendLog } from "../../types/spend";
import { readSseEvents } from "./protocol/sse";
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

function adapter(protocol: "chat" | "gemini"): SubscriptionProviderAdapter {
	return {
		source: "codex",
		displayName: "Codex",
		auth: {
			source: "codex",
			ensureCredential: async () => "token",
			refresh: async () => undefined,
		},
		supports: () => true,
		route: () => protocol,
		countTokens: async () => 12,
		resolveModel: (model) => model,
		build: async (context) => ({
			url: "https://upstream.test/chat/completions",
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: context.upstreamBody,
			model: context.model,
			stream: context.stream,
			protocol: protocol,
		}),
		catalog: async () => [],
		quota: async () => ({ fetchedAt: new Date().toISOString() }),
	};
}

function buildApp(db?: DrizzleDb, protocol: "chat" | "gemini" = "chat"): express.Express {
	const provider = adapter(protocol);
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
	app.use(requestArrivalMiddleware);
	app.use(express.json());
	app.use((req, _res, next) => {
		req.auth = { api_key: "sk-test", user_id: "user-1" } as never;
		next();
	});
	const expressRouter = express.Router();
	registerSubscriptionSpecialRoutes(expressRouter, router as never, db);
	app.use(expressRouter);
	return app;
}

afterEach(() => {
	setSubscriptionRequestHandler(undefined);
	jest.restoreAllMocks();
});

function nextSettledLog(): Promise<SpendLog> {
	return new Promise((resolve) => {
		jest.spyOn(settlement, "queueSpendLog").mockImplementationOnce(async (_db, entry) => resolve(entry));
	});
}

it("Gemini 逐帧转发时忽略心跳与用量，记录首段内容，并使用最后一帧的用量结算", async () => {
	const server = buildApp({} as DrizzleDb, "gemini").listen(0, "127.0.0.1");
	await once(server, "listening");
	const clientFetch = globalThis.fetch.bind(globalThis);
	const stream = new TransformStream<Uint8Array, Uint8Array>();
	const writer = stream.writable.getWriter();
	const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
		new Response(stream.readable, { headers: { "content-type": "text/event-stream" } }),
	);
	const requestBody = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] });
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1beta/models/client-model:streamGenerateContent?alt=sse`;
	const call = () => clientFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: requestBody });
	const usage = { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 };
	const encode = (payload: unknown) => Buffer.from(`data: ${JSON.stringify(payload)}\r\n\r\n`);
	try {
		const settled = nextSettledLog();
		const response = await call();
		expect(response.status).toBe(200);
		const frames = readSseEvents(response.body!);
		await writer.write(Buffer.from(": heartbeat\r\n\r\n"));
		await writer.write(encode({ candidates: [{ content: { parts: [{ text: "" }] } }], usageMetadata: { promptTokenCount: 3 } }));
		expect((await frames.next()).value?.data).toMatchObject({ usageMetadata: { promptTokenCount: 3 } });
		await delay(12);
		const beforeContent = Date.now();
		const content = encode({ candidates: [{ content: { parts: [{ text: "首字" }] } }] });
		const split = content.indexOf("首") + 1;
		await writer.write(content.subarray(0, split));
		await writer.write(content.subarray(split));
		expect((await frames.next()).value?.data).toMatchObject({ candidates: [{ content: { parts: [{ text: "首字" }] } }] });
		const deliveredAt = Date.now();
		await delay(12);
		const tail = encode({ candidates: [{ finishReason: "STOP" }], usageMetadata: usage });
		// Some native SSE servers stop after the last data line, without the final blank line.
		await writer.write(tail.subarray(0, tail.length - 4));
		await writer.close();
		expect((await frames.next()).value?.data).toMatchObject({ usageMetadata: usage });
		expect((await frames.next()).done).toBe(true);
		const log = await settled;
		const first = Date.parse(log.completionStartTime ?? "");
		expect(first).toBeGreaterThanOrEqual(beforeContent);
		expect(first).toBeLessThanOrEqual(deliveredAt);
		expect(first).toBeLessThan(Date.parse(log.endTime));
		expect(log.total_tokens).toBe(5);
		const empty = nextSettledLog();
		fetchSpy.mockResolvedValueOnce(new Response(encode({ usageMetadata: usage }), { headers: { "content-type": "text/event-stream" } }));
		await (await call()).text();
		expect((await empty).completionStartTime).toBeNull();
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

it("Gemini 在内容到达前原样发送心跳，客户端离开就停止读取上游", async () => {
	const server = buildApp(undefined, "gemini").listen(0, "127.0.0.1");
	await once(server, "listening");
	const clientFetch = globalThis.fetch.bind(globalThis);
	const heartbeat = ": keep-alive\r\n\r\n";
	const cancelled = new Promise<void>((resolve) => {
		const upstream = new ReadableStream<Uint8Array>({
			start: (controller) => controller.enqueue(Buffer.from(heartbeat)),
			cancel: () => resolve(),
		});
		jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(upstream, { headers: { "content-type": "text/event-stream" } }));
	});
	const controller = new AbortController();
	try {
		const response = await clientFetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1beta/models/client-model:streamGenerateContent`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ contents: [] }),
			signal: controller.signal,
		});
		const first = await response.body!.getReader().read();
		expect(new TextDecoder().decode(first.value)).toBe(heartbeat);
		controller.abort();
		await cancelled;
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
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
