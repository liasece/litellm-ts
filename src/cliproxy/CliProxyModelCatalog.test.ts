import {
	COMMANDCODE_MODEL_PREFIX,
	MODEL_CATALOG_POLL_INTERVAL_MS,
	OPENCODE_GO_MODEL_PREFIX,
	expectedModelPrefixes,
	extractModelIds,
	missingModelPrefixes,
	waitForModelCatalog,
} from "./CliProxyModelCatalog";

describe("expectedModelPrefixes", () => {
	it("没有托管插件时不等待任何前缀", () => {
		expect(expectedModelPrefixes(null)).toEqual([]);
	});

	it("按启用的插件列出前缀", () => {
		expect(expectedModelPrefixes({ dir: "/plugins", opencodeGo: true, commandcode: true })).toEqual([
			OPENCODE_GO_MODEL_PREFIX,
			COMMANDCODE_MODEL_PREFIX,
		]);
		expect(expectedModelPrefixes({ dir: "/plugins", opencodeGo: false, commandcode: true })).toEqual([COMMANDCODE_MODEL_PREFIX]);
	});
});

describe("extractModelIds", () => {
	it("读取 OpenAI 风格的 data 列表", () => {
		expect(extractModelIds({ object: "list", data: [{ id: "commandcode/deepseek/deepseek-v4.1-flash" }, { id: "b" }] })).toEqual([
			"commandcode/deepseek/deepseek-v4.1-flash",
			"b",
		]);
	});

	it("兼容插件信封形式的 models 列表", () => {
		expect(extractModelIds({ provider: "commandcode", models: [{ id: "opencode-go/x" }] })).toEqual(["opencode-go/x"]);
	});

	it("去重并忽略无法识别的条目", () => {
		expect(extractModelIds(["a", { id: "a" }, { name: " b " }, { id: "   " }, 42, null])).toEqual(["a", "b"]);
	});

	it("非列表响应返回空", () => {
		expect(extractModelIds(null)).toEqual([]);
		expect(extractModelIds("nope")).toEqual([]);
		expect(extractModelIds({ data: "nope" })).toEqual([]);
	});
});

describe("missingModelPrefixes", () => {
	it("前缀下有模型时视为就绪", () => {
		expect(
			missingModelPrefixes(
				["commandcode/deepseek/deepseek-v4.1-flash", "opencode-go/deepseek-v4.1-flash"],
				[COMMANDCODE_MODEL_PREFIX, OPENCODE_GO_MODEL_PREFIX],
			),
		).toEqual([]);
		expect(missingModelPrefixes(["commandcode"], [COMMANDCODE_MODEL_PREFIX])).toEqual([]);
	});

	it("只匹配前缀边界，不把相近前缀当成命中", () => {
		expect(missingModelPrefixes(["commandcode-other/x"], [COMMANDCODE_MODEL_PREFIX])).toEqual([COMMANDCODE_MODEL_PREFIX]);
		expect(missingModelPrefixes([], [OPENCODE_GO_MODEL_PREFIX])).toEqual([OPENCODE_GO_MODEL_PREFIX]);
	});
});

describe("waitForModelCatalog", () => {
	const prefixes = [COMMANDCODE_MODEL_PREFIX];

	it("前缀为空时直接就绪，不发请求", async () => {
		const fetchModelIds = jest.fn(async () => []);
		await expect(
			waitForModelCatalog({ prefixes: [], fetchModelIds: fetchModelIds, isAborted: () => false, timeoutMs: 100 }),
		).resolves.toMatchObject({ ready: true, aborted: false, missing: [] });
		expect(fetchModelIds).not.toHaveBeenCalled();
	});

	it("目录已经有前缀模型时立即就绪", async () => {
		const fetchModelIds = jest.fn(async () => [COMMANDCODE_MODEL_PREFIX + "/deepseek/deepseek-v4.1-flash"]);
		const result = await waitForModelCatalog({
			prefixes: prefixes,
			fetchModelIds: fetchModelIds,
			isAborted: () => false,
			timeoutMs: 100,
		});
		expect(result.ready).toBe(true);
		expect(result.waitedMs).toBeLessThan(100);
		expect(fetchModelIds).toHaveBeenCalledTimes(1);
	});

	it("插件注册落后于健康检查时轮询等待，注册后返回就绪", async () => {
		let calls = 0;
		const fetchModelIds = jest.fn(async () => {
			calls += 1;
			return calls < 3 ? [] : [COMMANDCODE_MODEL_PREFIX + "/deepseek/deepseek-v4.1-flash"];
		});
		const result = await waitForModelCatalog({
			prefixes: prefixes,
			fetchModelIds: fetchModelIds,
			isAborted: () => false,
			timeoutMs: 2_000,
			pollIntervalMs: 10,
		});
		expect(result.ready).toBe(true);
		expect(fetchModelIds).toHaveBeenCalledTimes(3);
	});

	it("读取失败按未就绪继续轮询，不把异常抛给启动流程", async () => {
		let calls = 0;
		const fetchModelIds = jest.fn(async () => {
			calls += 1;
			if (calls === 1) {
				throw new Error("connect ECONNREFUSED");
			}
			return [COMMANDCODE_MODEL_PREFIX + "/deepseek/deepseek-v4.1-flash"];
		});
		const result = await waitForModelCatalog({
			prefixes: prefixes,
			fetchModelIds: fetchModelIds,
			isAborted: () => false,
			timeoutMs: 2_000,
			pollIntervalMs: 5,
		});
		expect(result.ready).toBe(true);
		expect(calls).toBe(2);
	});

	it("超时后返回缺失前缀，供调用方记日志但不阻断启动", async () => {
		const fetchModelIds = jest.fn(async () => []);
		const result = await waitForModelCatalog({
			prefixes: [COMMANDCODE_MODEL_PREFIX, OPENCODE_GO_MODEL_PREFIX],
			fetchModelIds: fetchModelIds,
			isAborted: () => false,
			timeoutMs: 60,
			pollIntervalMs: 10,
		});
		expect(result.ready).toBe(false);
		expect(result.aborted).toBe(false);
		expect(result.missing).toEqual([COMMANDCODE_MODEL_PREFIX, OPENCODE_GO_MODEL_PREFIX]);
		expect(result.waitedMs).toBeGreaterThanOrEqual(50);
	});

	it("停机或子进程退出后立即放弃等待", async () => {
		const fetchModelIds = jest.fn(async () => []);
		let aborted = false;
		const waiting = waitForModelCatalog({
			prefixes: prefixes,
			fetchModelIds: fetchModelIds,
			isAborted: () => aborted,
			timeoutMs: 5_000,
			pollIntervalMs: MODEL_CATALOG_POLL_INTERVAL_MS,
		});
		await new Promise((resolve) => setTimeout(resolve, 30));
		aborted = true;
		const result = await waiting;
		expect(result.aborted).toBe(true);
		expect(result.ready).toBe(false);
		expect(fetchModelIds.mock.calls.length).toBeLessThan(5);
	});
});
