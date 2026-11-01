import type { Router } from "../router/Router";
import type { BuiltinCapabilityAuditHook, BuiltinCapabilityModelCall } from "./BuiltinCapabilityAudit";
import { normalizeBuiltinCapabilitiesConfig } from "./BuiltinCapabilitiesConfig";
import { executeWebToolCall } from "./WebCapabilityExecution";
import { PRIVATE_WEB_SEARCH_TOOL_NAME } from "./WebCapabilityProtocol";

function stubRouter(): Router {
	return {
		getDeployments: () => [],
		supportsNativeResponses: () => false,
	} as unknown as Router;
}

function credentialAccessor(values: Record<string, Record<string, unknown>>) {
	return {
		getValues: (credentialName: string) => values[credentialName],
	};
}

function searchResponse(results: Record<string, unknown>[]): unknown {
	return { results: results };
}

interface FetchRecord {
	readonly url: string;
	readonly body: Record<string, unknown>;
	readonly authorization: string | undefined;
}

function mockDeepSeek(handler: (path: string, body: Record<string, unknown>) => { status: number; body: unknown }): FetchRecord[] {
	const records: FetchRecord[] = [];
	global.fetch = jest.fn(async (input: any, init: any) => {
		const url = String(input);
		const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
		records.push({ url: url, body: body, authorization: init?.headers?.["Authorization"] });
		const outcome = handler(new URL(url).pathname, body);
		return {
			ok: outcome.status >= 200 && outcome.status < 300,
			status: outcome.status,
			text: async () => JSON.stringify(outcome.body),
		} as unknown as Response;
	}) as unknown as typeof fetch;
	return records;
}

afterEach(() => {
	jest.restoreAllMocks();
	delete (global as { fetch?: unknown }).fetch;
});

describe("web 执行链：直连执行者", () => {
	const bindingBase = {
		maxIterations: 3,
		maxOutputTokens: 1024,
	};

	it("链上只有 DeepSeek 直连执行者时，不调用任何模型就返回真实搜索结果", async () => {
		const records = mockDeepSeek(() => ({
			status: 200,
			body: searchResponse([
				{ title: "Docs", url: "https://example.com/docs", summary: "API limits", date: "2026-10-01" },
			]),
		}));
		const complete = jest.fn();

		const result = await executeWebToolCall(
			stubRouter(),
			{
				...bindingBase,
				executors: [
					{
						type: "deepseek_tools",
						api_base: "https://api.deepseek.com",
						credential_name: "deepseek-prod",
						timeout_ms: 5_000,
						search_count: 10,
						search_need_content: false,
						localization: "",
					},
				],
				credentialValues: credentialAccessor({ "deepseek-prod": { api_key: "sk-direct" } }),
			},
			PRIVATE_WEB_SEARCH_TOOL_NAME,
			JSON.stringify({ query: "deepseek api" }),
			complete,
		);

		expect(complete).not.toHaveBeenCalled();
		expect(records).toHaveLength(1);
		expect(records[0]!.url).toBe("https://api.deepseek.com/v1/tools/search");
		expect(result.text).toContain("https://example.com/docs");
		expect(result.model).toBe("deepseek_tools/search");
	});

	it("DeepSeek 失败后按链序回落到模型执行者，并记录两次尝试", async () => {
		mockDeepSeek(() => ({ status: 429, body: { error: { message: "rate limit" } } }));
		const complete = jest.fn(async () => ({
			id: "chatcmpl",
			object: "chat.completion",
			created: 1,
			model: "network-model",
			choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Recovered via model." } }],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		}));

		const result = await executeWebToolCall(
			stubRouter(),
			{
				...bindingBase,
				executors: [
					{
						type: "deepseek_tools",
						api_base: "https://api.deepseek.com",
						credential_name: "deepseek-prod",
						timeout_ms: 5_000,
						search_count: 10,
						search_need_content: false,
						localization: "",
					},
					{ type: "model", model: "network-model" },
				],
				credentialValues: credentialAccessor({ "deepseek-prod": { api_key: "sk-direct" } }),
			},
			PRIVATE_WEB_SEARCH_TOOL_NAME,
			JSON.stringify({ query: "fallback please" }),
			complete,
		);

		expect(complete).toHaveBeenCalledTimes(1);
		expect(result.text).toContain("Recovered via model");
		expect(result.model).toBe("network-model");
		expect(result.attempts.map((attempt) => attempt.status)).toEqual(["failure", "success"]);
	});

	it("模型执行者排在前面时就先走模型，直连执行者不被提前调用", async () => {
		const records = mockDeepSeek(() => ({ status: 200, body: searchResponse([]) }));
		const complete = jest.fn(async () => ({
			id: "chatcmpl",
			object: "chat.completion",
			created: 1,
			model: "network-model",
			choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Model answered first." } }],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		}));

		const result = await executeWebToolCall(
			stubRouter(),
			{
				...bindingBase,
				executors: [
					{ type: "model", model: "network-model" },
					{
						type: "deepseek_tools",
						api_base: "https://api.deepseek.com",
						credential_name: "deepseek-prod",
						timeout_ms: 5_000,
						search_count: 10,
						search_need_content: false,
						localization: "",
					},
				],
				credentialValues: credentialAccessor({ "deepseek-prod": { api_key: "sk-direct" } }),
			},
			PRIVATE_WEB_SEARCH_TOOL_NAME,
			JSON.stringify({ query: "model first" }),
			complete,
		);

		expect(complete).toHaveBeenCalledTimes(1);
		expect(records).toHaveLength(0);
		expect(result.text).toContain("Model answered first");
	});

	it("Credential 缺少 api_key 时明确报错，不回落到环境变量", async () => {
		const records = mockDeepSeek(() => ({ status: 200, body: searchResponse([]) }));
		process.env["DEEPSEEK_API_KEY"] = "sk-from-env";

		await expect(
			executeWebToolCall(
				stubRouter(),
				{
					...bindingBase,
					executors: [
						{
							type: "deepseek_tools",
							api_base: "https://api.deepseek.com",
							credential_name: "empty-credential",
							timeout_ms: 5_000,
							search_count: 10,
							search_need_content: false,
							localization: "",
						},
					],
					credentialValues: credentialAccessor({ "empty-credential": {} }),
				},
				PRIVATE_WEB_SEARCH_TOOL_NAME,
				JSON.stringify({ query: "x" }),
				jest.fn(),
			),
		).rejects.toMatchObject({ message: expect.stringContaining("api_key") });

		expect(records).toHaveLength(0);
		delete process.env["DEEPSEEK_API_KEY"];
	});
});

describe("web 执行链：按次计费可观察性", () => {
	it("直连调用写入固定费用与 asearch 调用类型，使按次支出出现在费用统计里", async () => {
		mockDeepSeek(() => ({
			status: 200,
			body: searchResponse([{ title: "T", url: "https://example.com", summary: "S" }]),
		}));
		const audited: BuiltinCapabilityModelCall[] = [];
		const audit: BuiltinCapabilityAuditHook = async (call) => {
			audited.push(call);
			return { requestId: "audit-1" };
		};

		await executeWebToolCall(
			stubRouter(),
			{
				maxIterations: 3,
				maxOutputTokens: 1024,
				executors: [
					{
						type: "deepseek_tools",
						api_base: "https://api.deepseek.com",
						credential_name: "deepseek-prod",
						timeout_ms: 5_000,
						search_count: 10,
						search_need_content: false,
						localization: "",
					},
				],
				credentialValues: credentialAccessor({ "deepseek-prod": { api_key: "sk-direct" } }),
			},
			PRIVATE_WEB_SEARCH_TOOL_NAME,
			JSON.stringify({ query: "billing" }),
			jest.fn(),
			{ audit: audit, toolCallId: "call-1" },
		);

		expect(audited).toHaveLength(1);
		expect(audited[0]!.callType).toBe("asearch");
		expect(audited[0]!.fixedCostUsd).toBeCloseTo(0.00075, 10);
		expect(audited[0]!.credentialName).toBe("deepseek-prod");
		expect(JSON.stringify(audited[0])).not.toContain("sk-direct");
	});

	it("模型执行者不写固定费用，避免把 token 计费重复计入按次支出", async () => {
		const audited: BuiltinCapabilityModelCall[] = [];
		const audit: BuiltinCapabilityAuditHook = async (call) => {
			audited.push(call);
			return { requestId: "audit-2" };
		};
		const complete = jest.fn(async () => ({
			id: "chatcmpl",
			object: "chat.completion",
			created: 1,
			model: "network-model",
			choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		}));

		await executeWebToolCall(
			stubRouter(),
			{
				maxIterations: 3,
				maxOutputTokens: 1024,
				executors: [{ type: "model", model: "network-model" }],
			},
			PRIVATE_WEB_SEARCH_TOOL_NAME,
			JSON.stringify({ query: "no fixed cost" }),
			complete,
			{ audit: audit, toolCallId: "call-2" },
		);

		expect(audited[0]!.callType).toBe("acompletion");
		expect(audited[0]!.fixedCostUsd).toBeUndefined();
	});
});

describe("执行链配置归一化", () => {
	it("历史 handler_model + fallback_models 折算为等价 model 链，保持旧语义", () => {
		const config = normalizeBuiltinCapabilitiesConfig({
			web: {
				enabled: true,
				handler_model: "network-model",
				fallback_models: ["network-fallback"],
				max_iterations: 3,
				max_output_tokens: 2048,
			},
		});
		expect(config.web.executors).toEqual([
			{ type: "model", model: "network-model" },
			{ type: "model", model: "network-fallback" },
		]);
		expect(config.web.handler_model).toBe("network-model");
	});

	it("未配置直连执行者时绝不隐式启用，默认仍是空链", () => {
		const config = normalizeBuiltinCapabilitiesConfig({});
		expect(config.web.executors).toEqual([]);
		expect(config.web.enabled).toBe(false);
		expect(config.web.handler_model).toBe("");
	});

	it("所谓非 web 能力不接受 deepseek_tools 元素", () => {
		const config = normalizeBuiltinCapabilitiesConfig({
			vision: {
				enabled: true,
				executors: [{ type: "deepseek_tools", credential_name: "deepseek-prod" }],
			},
		});
		expect(config.vision.executors).toEqual([]);
	});

	it("直连执行者缺少 credential_name 时被丢弃，避免保存不可执行的元素", () => {
		const config = normalizeBuiltinCapabilitiesConfig({
			web: { enabled: true, executors: [{ type: "deepseek_tools", api_base: "https://api.deepseek.com" }] },
		});
		expect(config.web.executors).toEqual([]);
	});

	it("保留链上混合类型的声明顺序", () => {
		const config = normalizeBuiltinCapabilitiesConfig({
			web: {
				enabled: true,
				executors: [
					{ type: "model", model: "network-model" },
					{ type: "deepseek_tools", credential_name: "deepseek-prod", search_count: 25, search_need_content: true },
					{ type: "model", model: "network-fallback" },
				],
			},
		});
		expect(config.web.executors).toEqual([
			{ type: "model", model: "network-model" },
			{
				type: "deepseek_tools",
				api_base: "https://api.deepseek.com",
				credential_name: "deepseek-prod",
				timeout_ms: 15_000,
				search_count: 25,
				search_need_content: true,
				localization: "",
			},
			{ type: "model", model: "network-fallback" },
		]);
	});
});
