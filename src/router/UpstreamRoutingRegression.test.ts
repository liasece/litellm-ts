jest.mock("./RouterExecutionBackoff", () => ({ computeSleepBeforeRetry: () => 0 }));
import { Router } from "./Router";
import { RoutingStrategyName, type Deployment } from "../types/router";
import { ProviderRegistry } from "../providers/ProviderRegistry";
import { OpenAICompatProvider } from "../providers/OpenAICompatProvider";
import { buildStreamWithTtft } from "./RouterStreamWrapper";
import { filterDeploymentsByTags } from "./TagRouting";
import { getRetryPolicyOverride } from "./RouterRetryPolicy";
import { NotFoundError, ServiceUnavailableError } from "./RouterErrors";

function deployment(name: string, id = name): Deployment {
	return { model_name: name, litellm_params: { model: `openai/${name}`, api_key: "test-provider-secret" }, model_info: { id: id } };
}
function router(deployments: Deployment[], extra = {}): Router {
	return new Router({ model_list: deployments, routing_strategy: RoutingStrategyName.SimpleShuffle, num_retries: 0, ...extra });
}
const message = [{ role: "user", content: "hi" }];


/** 读取 fetch 收到的请求头（统一小写键）：上游改写成 Headers 后普通对象断言不再成立。 */
function sentHeaders(call: unknown[] | undefined): Record<string, string> {
	const init = call?.[1] as { headers?: unknown } | undefined;
	const headers = init?.headers;
	const entries =
		headers instanceof Headers
			? [...headers.entries()]
			: Object.entries((headers ?? {}) as Record<string, string>);
	return Object.fromEntries(entries.map(([key, value]) => [key.toLowerCase(), String(value)]));
}

describe("upstream Router regressions and strategy additions", () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});
	it("keeps the parallel slot until stream completion, including return before first next", async () => {
		const dep = deployment("a");
		dep.litellm_params["max_parallel_requests"] = 1;
		jest.spyOn(global, "fetch").mockImplementation(
			async () => new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', { status: 200 }),
		);
		const instance = router([dep]);
		const first = await instance.acompletion("a", message, { stream: true });
		await expect(instance.acompletion("a", message, { stream: true })).rejects.toThrow("max_parallel_requests");
		await (first["stream"] as AsyncGenerator<unknown>).return(undefined);
		const next = await instance.acompletion("a", message, { stream: true });
		for await (const _chunk of next["stream"] as AsyncGenerator<unknown>) {
			/* consume */
		}
		await expect(instance.acompletion("a", message, { stream: true })).resolves.toHaveProperty("_stream", true);
	});
	it("honors request num_retries=0 even over deployment and policy retry defaults", async () => {
		const dep = deployment("a");
		dep.litellm_params.num_retries = 2;
		const fetch = jest.spyOn(global, "fetch").mockImplementation(async () => new Response('{"error":"failed"}', { status: 500 }));
		await expect(
			router([dep], { retry_policy: { InternalServerErrorRetries: 2 } }).acompletion("a", message, { num_retries: 0 }),
		).rejects.toThrow();
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it("continues a sibling fallback before first semantic output and updates spend identity", async () => {
		const provider = new OpenAICompatProvider("test-key", "https://example.invalid/v1");
		jest.spyOn(provider, "streamResponse").mockImplementation(async function* (response) {
			if (response.headers.get("x-test") === "b") throw new Error("before first chunk");
			yield { choices: [{ index: 0, delta: { content: "ok" } }] } as never;
		});
		jest.spyOn(ProviderRegistry.prototype, "getProvider").mockReturnValue(provider);
		jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
			const name = (JSON.parse(String(init?.body)) as { model: string }).model;
			return new Response(name === "a" ? '{"error":"unavailable"}' : "", {
				status: name === "a" ? 503 : 200,
				headers: { "x-test": name },
			});
		});
		const result = await router([deployment("a"), deployment("b"), deployment("c")], { fallbacks: [{ a: ["b", "c"] }] }).acompletion(
			"a",
			message,
			{ stream: true },
		);
		const chunks = [];
		for await (const chunk of result["stream"] as AsyncGenerator<unknown>) chunks.push(chunk);
		expect(chunks).toEqual([{ choices: [{ index: 0, delta: { content: "ok" } }] }]);
		expect((result["_spendInfo"] as { modelId: string }).modelId).toBe("c");
	});
	it("keeps falling back when the upstream breaks after envelope-only chunks", async () => {
		const provider = new OpenAICompatProvider("test-key", "https://example.invalid/v1");
		jest.spyOn(provider, "streamResponse").mockImplementation(async function* (response) {
			if (response.headers.get("x-test") === "a") {
				yield { choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] } as never;
				throw new TypeError("terminated");
			}
			yield { choices: [{ index: 0, delta: { content: "ok" } }] } as never;
		});
		jest.spyOn(ProviderRegistry.prototype, "getProvider").mockReturnValue(provider);
		jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
			const name = (JSON.parse(String(init?.body)) as { model: string }).model;
			return new Response("", { status: 200, headers: { "x-test": name } });
		});
		const result = await router([deployment("a"), deployment("b")], { fallbacks: [{ a: ["b"] }] }).acompletion(
			"a",
			message,
			{ stream: true },
		);
		const chunks: unknown[] = [];
		for await (const chunk of result["stream"] as AsyncGenerator<unknown>) chunks.push(chunk);
		expect(chunks).toEqual([
			{ choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
			{ choices: [{ index: 0, delta: { content: "ok" } }] },
		]);
		expect((result["_spendInfo"] as { modelId: string }).modelId).toBe("b");
	});
	it("keeps falling back when the upstream breaks after reasoning-only output", async () => {
		const provider = new OpenAICompatProvider("test-key", "https://example.invalid/v1");
		jest.spyOn(provider, "streamResponse").mockImplementation(async function* (response) {
			if (response.headers.get("x-test") === "a") {
				yield { choices: [{ index: 0, delta: { reasoning_content: "thinking hard" }, finish_reason: null }] } as never;
				throw new TypeError("terminated");
			}
			yield { choices: [{ index: 0, delta: { content: "ok" } }] } as never;
		});
		jest.spyOn(ProviderRegistry.prototype, "getProvider").mockReturnValue(provider);
		jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
			const name = (JSON.parse(String(init?.body)) as { model: string }).model;
			return new Response("", { status: 200, headers: { "x-test": name } });
		});
		const result = await router([deployment("a"), deployment("b")], { fallbacks: [{ a: ["b"] }] }).acompletion(
			"a",
			message,
			{ stream: true },
		);
		const chunks: unknown[] = [];
		for await (const chunk of result["stream"] as AsyncGenerator<unknown>) chunks.push(chunk);
		expect(chunks).toEqual([
			{ choices: [{ index: 0, delta: { reasoning_content: "thinking hard" }, finish_reason: null }] },
			{ choices: [{ index: 0, delta: { content: "ok" } }] },
		]);
		expect((result["_spendInfo"] as { modelId: string }).modelId).toBe("b");
	});
	it("measures first chunk latency lazily without dividing by output token count", async () => {
		let now = 1000;
		jest.spyOn(Date, "now").mockImplementation(() => now);
		const provider = new OpenAICompatProvider("test-key", "https://example.invalid");
		jest.spyOn(provider, "streamResponse").mockImplementation(async function* () {
			now = 1400;
			yield { choices: [], usage: { completion_tokens: 100 } } as never;
		});
		const measured = buildStreamWithTtft(new Response(""), 1000, provider);
		expect(measured.ttft).toBe(0);
		for await (const _chunk of measured.stream) {
			/* consume */
		}
		expect(measured.ttft).toBe(400);
	});
	it("uses percentile TTFT rather than last sample or total latency for streams", () => {
		const a = deployment("group", "a");
		const b = deployment("group", "b");
		const instance = router([a, b], {
			routing_strategy: RoutingStrategyName.LatencyBasedRouting,
			routing_strategy_args: { ttft_percentile: 0.9 },
		});
		for (const value of [100, 1, 1]) instance.recordDeploymentTtft(a, value);
		for (const value of [50, 50, 50]) instance.recordDeploymentTtft(b, value);
		expect(instance.getAvailableDeployment("group", message, { stream: true })?.deployment.model_info?.id).toBe("b");
	});
	it("counts tool schemas in context checks before invoking the provider", async () => {
		const dep = deployment("a");
		dep.model_info!.max_input_tokens = 50;
		const fetch = jest.spyOn(global, "fetch");
		await expect(
			router([dep], { pre_call_checks: true }).acompletion("a", message, { tools: [{ description: "large schema ".repeat(500) }] }),
		).rejects.toThrow("Context window");
		expect(fetch).not.toHaveBeenCalled();
	});
	it("combines exclusions, required and OR tags and uses the default pool for deny-only requests", () => {
		const a = deployment("a");
		a.litellm_params["tags"] = ["default", "eu", "fast"];
		const b = deployment("b");
		b.litellm_params["tags"] = ["us", "fast"];
		expect(filterDeploymentsByTags([a, b], {})).toEqual([a, b]);
		expect(filterDeploymentsByTags([a, b], { metadata: { tags: ["&fast", "!us"] } })).toEqual([a]);
		expect(filterDeploymentsByTags([a, b], { metadata: { tags: ["!eu"] } })).toEqual([]);
		expect(filterDeploymentsByTags([a, b], { metadata: { tags: ["us", "eu"] } })).toEqual([a, b]);
	});
	it("resolves service-unavailable/not-found/default retry policies by hierarchy", () => {
		expect(
			getRetryPolicyOverride(
				new ServiceUnavailableError("503"),
				{ InternalServerErrorRetries: 3, DefaultRetries: 1 },
				"a",
				undefined,
			),
		).toBe(3);
		expect(getRetryPolicyOverride(new NotFoundError("404"), { NotFoundErrorRetries: 0, DefaultRetries: 1 }, "a", undefined)).toBe(0);
		expect(getRetryPolicyOverride(new Error("network"), { DefaultRetries: 1 }, "a", undefined)).toBe(1);
	});
});

it("honors service-unavailable retry counts larger than deployment defaults", async () => {
	let attempts = 0;
	const fetch = jest.spyOn(global, "fetch").mockImplementation(async () => {
		attempts++;
		return new Response(attempts < 5 ? '{"error":"unavailable"}' : '{"choices":[]}', { status: attempts < 5 ? 503 : 200 });
	});
	try {
		await router([deployment("a"), deployment("a", "a2")], { retry_policy: { ServiceUnavailableErrorRetries: 4 } }).acompletion(
			"a",
			message,
		);
		expect(fetch).toHaveBeenCalledTimes(5);
	} finally {
		jest.restoreAllMocks();
	}
});

it("isolates request tag routing for native selectors that do not receive optional parameters", async () => {
	const eu = deployment("group", "eu");
	eu.litellm_params["tags"] = ["eu"];
	const us = deployment("group", "us");
	us.litellm_params["tags"] = ["us"];
	const instance = router([eu, us]);
	const results = await Promise.all(
		["eu", "us"].map((tag) =>
			instance.runWithRequestRoutingParams({ metadata: { tags: [tag] } }, async () => {
				await Promise.resolve();
				return instance.getAvailableDeployment("group")?.deployment.model_info?.id;
			}),
		),
	);
	expect(results).toEqual(["eu", "us"]);
});

it("pins Responses connection credentials and URL to the selected deployment", async () => {
	const dep = deployment("native");
	dep.litellm_params.api_base = "https://approved.invalid/v1";
	dep.litellm_params["supported_endpoints"] = ["/v1/responses"];
	const fetch = jest.spyOn(global, "fetch").mockResolvedValue(new Response('{"object":"response","output":[]}'));
	try {
		await router([dep]).acompletion("native", message, {
			__litellm_call_type: "responses",
			__litellm_responses_body: { input: "hi", api_key: "client-key", api_base: "https://unapproved.invalid" },
			api_key: "client-key",
			api_base: "https://unapproved.invalid",
		});
		expect(fetch.mock.calls[0]?.[0]).toBe("https://approved.invalid/v1/responses");
		expect(sentHeaders(fetch.mock.calls[0])["authorization"]).toBe("Bearer test-provider-secret");
	} finally {
		jest.restoreAllMocks();
	}
});

it("aborts a pending stream and releases its deployment slot when the consumer returns", async () => {
	const dep = deployment("a");
	dep.litellm_params["max_parallel_requests"] = 1;
	let aborted = false;
	const fetch = jest.spyOn(global, "fetch").mockImplementation(
		async (_url, init) =>
			new Response(
				new ReadableStream({
					start(controller) {
						init?.signal?.addEventListener("abort", () => {
							aborted = true;
							controller.error(new DOMException("cancelled", "AbortError"));
						});
					},
				}),
			),
	);
	try {
		const instance = router([dep]);
		const result = await instance.acompletion("a", message, { stream: true });
		const stream = result["stream"] as AsyncGenerator<unknown>;
		const pending = stream.next();
		await Promise.resolve();
		await stream.return(undefined);
		await pending;
		expect(aborted).toBe(true);
		const next = await instance.acompletion("a", message, { stream: true });
		await (next["stream"] as AsyncGenerator<unknown>).return(undefined);
	} finally {
		fetch.mockRestore();
	}
});

it("redacts connection credentials from a failure after stream output without replaying it", async () => {
	const secret = "credential-resolved-outside-deployment";
	const provider = new OpenAICompatProvider(secret, "https://example.invalid/v1");
	const transform = provider.transformRequest.bind(provider);
	jest.spyOn(provider, "transformRequest").mockImplementation((model, messages, params) => {
		const request = transform(model, messages, params);
		return { ...request, headers: { ...request.headers, Authorization: `Bearer ${secret}` } };
	});
	jest.spyOn(ProviderRegistry.prototype, "getProvider").mockReturnValue(provider);
	jest.spyOn(provider, "streamResponse").mockImplementation(async function* () {
		yield { choices: [{ delta: { content: "ok" } }] } as never;
		throw new Error(`upstream rejected ${secret}`);
	});
	const fetch = jest.spyOn(global, "fetch").mockResolvedValue(new Response(""));
	try {
		const result = await router([deployment("a"), deployment("b")], { fallbacks: [{ a: ["b"] }] }).acompletion("a", message, {
			stream: true,
		});
		const chunks = [];
		for await (const chunk of result["stream"] as AsyncGenerator<unknown>) chunks.push(chunk);
		expect(JSON.stringify(chunks)).not.toContain(secret);
		expect(JSON.stringify(chunks)).toContain("********");
		expect(fetch).toHaveBeenCalledTimes(1);
	} finally {
		jest.restoreAllMocks();
	}
});

it("attempts each configured streaming fallback only once when all fail before output", async () => {
	const provider = new OpenAICompatProvider("test-key", "https://example.invalid/v1");
	jest.spyOn(provider, "streamResponse").mockImplementation(async function* () {
		throw new Error("pre-output failure");
	});
	jest.spyOn(ProviderRegistry.prototype, "getProvider").mockReturnValue(provider);
	const attempted: string[] = [];
	jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
		attempted.push(JSON.parse(String(init?.body)).model);
		return new Response("");
	});
	try {
		const result = await router([deployment("a"), deployment("b"), deployment("c")], { fallbacks: [{ a: ["b", "c"] }] }).acompletion(
			"a",
			message,
			{ stream: true },
		);
		await expect(
			(async () => {
				for await (const _ of result["stream"] as AsyncGenerator<unknown>) {
				}
			})(),
		).rejects.toThrow("pre-output failure");
		expect(attempted).toEqual(["a", "b", "c"]);
	} finally {
		jest.restoreAllMocks();
	}
});

it("cancels a fallback still waiting for response headers without retrying another group", async () => {
	const provider = new OpenAICompatProvider("test-key", "https://example.invalid/v1");
	jest.spyOn(provider, "streamResponse").mockImplementation(async function* () {
		throw new Error("primary pre-output failure");
	});
	jest.spyOn(ProviderRegistry.prototype, "getProvider").mockReturnValue(provider);
	let connecting!: () => void;
	const waiting = new Promise<void>((resolve) => {
		connecting = resolve;
	});
	const attempted: string[] = [];
	let aborted = false;
	jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
		const name = JSON.parse(String(init?.body)).model;
		attempted.push(name);
		if (name === "a") return new Response("");
		return await new Promise<Response>((_resolve, reject) => {
			connecting();
			init?.signal?.addEventListener("abort", () => {
				aborted = true;
				reject(new DOMException("cancelled", "AbortError"));
			});
		});
	});
	try {
		const result = await router([deployment("a"), deployment("b"), deployment("c")], { fallbacks: [{ a: ["b", "c"] }] }).acompletion(
			"a",
			message,
			{ stream: true },
		);
		const stream = result["stream"] as AsyncGenerator<unknown>;
		const pending = stream.next();
		await waiting;
		await stream.return(undefined);
		await pending;
		expect(aborted).toBe(true);
		expect(attempted).toEqual(["a", "b"]);
	} finally {
		jest.restoreAllMocks();
	}
});
