import { ModelCostMapService } from "./ModelCostMapService";

const bundledMap = {
	"bundled-a": { input_cost_per_token: 1, output_cost_per_token: 2 },
	"bundled-b": { input_cost_per_token: 3, output_cost_per_token: 4 },
};

function makeService(fetchImpl: typeof fetch, env: NodeJS.ProcessEnv = {}): ModelCostMapService {
	return new ModelCostMapService({
		bundledRawJson: JSON.stringify(bundledMap),
		// 案例只验证快照与回退语义，屏蔽仓库补丁表，避免价格数据变化影响计数断言
		overridesRawJson: "{}",
		fetchImpl: fetchImpl,
		env: {
			LITELLM_MODEL_COST_MAP_MIN_MODELS: "1",
			LITELLM_MODEL_COST_MAP_MIN_BUNDLED_RATIO: "0.5",
			...env,
		},
	});
}

describe("ModelCostMapService", () => {
	it("bundled 数据损坏时直接阻断构造", () => {
		expect(() => new ModelCostMapService({ bundledRawJson: "[]" })).toThrow("bundled model cost map");
	});

	it("初始化远端失败时可靠回退 bundled，并保留真实原因", async () => {
		const service = makeService(jest.fn().mockRejectedValue(new Error("network down")) as typeof fetch);

		const snapshot = await service.initialize();

		expect(snapshot.source).toBe("local");
		expect(snapshot.fallbackReason).toContain("network down");
		expect(snapshot.modelCount).toBe(2);
		expect(snapshot.map["bundled-a"]).toBeDefined();
	});

	it("LITELLM_LOCAL_MODEL_COST_MAP=true 强制 local 且不请求远端", async () => {
		const fetchImpl = jest.fn() as unknown as typeof fetch;
		const service = makeService(fetchImpl, { LITELLM_LOCAL_MODEL_COST_MAP: "true" });

		const snapshot = await service.initialize();

		expect(fetchImpl).not.toHaveBeenCalled();
		expect(snapshot).toMatchObject({ source: "local", isEnvForced: true, url: null, fallbackReason: null });
	});

	it("使用环境变量远端 URL、超时 signal，并展开 alias，canonical 冲突时保留 canonical", async () => {
		const remoteMap = {
			canonical: { input_cost_per_token: 5, output_cost_per_token: 6, aliases: ["alias-a", "occupied"] },
			occupied: { input_cost_per_token: 7, output_cost_per_token: 8 },
		};
		const fetchImpl = jest
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify(remoteMap), { status: 200, headers: { "content-type": "application/json" } }),
			) as typeof fetch;
		const service = makeService(fetchImpl, {
			LITELLM_MODEL_COST_MAP_URL: "https://prices.example.test/map.json",
			LITELLM_MODEL_COST_MAP_TIMEOUT_MS: "1234",
		});

		const snapshot = await service.initialize();

		expect(fetchImpl).toHaveBeenCalledWith(
			"https://prices.example.test/map.json",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(snapshot.source).toBe("remote");
		expect(snapshot.url).toBe("https://prices.example.test/map.json");
		expect(snapshot.map["alias-a"]).toEqual(snapshot.map.canonical);
		expect(snapshot.map.occupied).toMatchObject({ input_cost_per_token: 7 });
	});

	it.each([
		["HTTP 错误", new Response("bad", { status: 503 })],
		["顶层数组", new Response("[]", { status: 200 })],
		["空对象", new Response("{}", { status: 200 })],
	])("%s 时回退 bundled", async (_name, response) => {
		const service = makeService(jest.fn().mockResolvedValue(response) as typeof fetch);
		const snapshot = await service.reload();
		expect(snapshot.source).toBe("local");
		expect(snapshot.fallbackReason).not.toBeNull();
		expect(snapshot.modelCount).toBe(2);
	});

	it("相对 bundled 异常缩水时拒绝远端数据", async () => {
		const largeBundled = Object.fromEntries(
			Array.from({ length: 10 }, (_, index) => [`bundled-${index}`, { input_cost_per_token: 1, output_cost_per_token: 2 }]),
		);
		const service = new ModelCostMapService({
			bundledRawJson: JSON.stringify(largeBundled),
			overridesRawJson: "{}",
			fetchImpl: jest
				.fn()
				.mockResolvedValue(
					new Response(JSON.stringify({ only: { input_cost_per_token: 1, output_cost_per_token: 2 } })),
				) as typeof fetch,
			env: { LITELLM_MODEL_COST_MAP_MIN_MODELS: "1", LITELLM_MODEL_COST_MAP_MIN_BUNDLED_RATIO: "0.5" },
		});

		const snapshot = await service.reload();

		expect(snapshot.source).toBe("local");
		expect(snapshot.fallbackReason).toContain("shrink");
		expect(snapshot.modelCount).toBe(10);
	});

	it("snapshot 深度不可变，reload 完成前读取方继续看到旧 snapshot，完成后原子替换", async () => {
		let resolveFetch!: (response: Response) => void;
		const pendingResponse = new Promise<Response>((resolve) => {
			resolveFetch = resolve;
		});
		const service = makeService(jest.fn().mockReturnValue(pendingResponse) as typeof fetch, {
			LITELLM_LOCAL_MODEL_COST_MAP: "true",
		});
		await service.initialize();
		const oldSnapshot = service.getSnapshot();
		(service as unknown as { _env: NodeJS.ProcessEnv })._env.LITELLM_LOCAL_MODEL_COST_MAP = "false";

		const reloadPromise = service.reload();
		expect(service.getSnapshot()).toBe(oldSnapshot);
		resolveFetch(new Response(JSON.stringify({ remote: { input_cost_per_token: 9, output_cost_per_token: 10 } })));
		const newSnapshot = await reloadPromise;

		expect(newSnapshot).not.toBe(oldSnapshot);
		expect(service.getSnapshot()).toBe(newSnapshot);
		expect(Object.isFrozen(newSnapshot)).toBe(true);
		expect(Object.isFrozen(newSnapshot.map)).toBe(true);
		expect(Object.isFrozen(newSnapshot.map.remote)).toBe(true);
	});

	it("initialize 幂等且 reload 合并并发请求", async () => {
		const fetchImpl = jest
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ remote: { input_cost_per_token: 9, output_cost_per_token: 10 } })),
			) as typeof fetch;
		const service = makeService(fetchImpl);

		const [first, second] = await Promise.all([service.initialize(), service.initialize()]);
		expect(first).toBe(second);
		expect(fetchImpl).toHaveBeenCalledTimes(1);

		await Promise.all([service.reload(), service.reload(), service.reload()]);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("schedule/cancel/status 使用进程内 unref timer", () => {
		const unref = jest.fn();
		const clearIntervalImpl = jest.fn();
		const timer = { unref: unref } as unknown as NodeJS.Timeout;
		const setIntervalImpl = jest.fn().mockReturnValue(timer);
		const service = new ModelCostMapService({
			bundledRawJson: JSON.stringify(bundledMap),
			overridesRawJson: "{}",
			env: { LITELLM_LOCAL_MODEL_COST_MAP: "true" },
			setIntervalImpl: setIntervalImpl,
			clearIntervalImpl: clearIntervalImpl,
		});

		const scheduled = service.schedule(2);
		expect(setIntervalImpl).toHaveBeenCalledWith(expect.any(Function), 2 * 60 * 60 * 1000);
		expect(unref).toHaveBeenCalled();
		expect(scheduled.scheduled).toBe(true);
		expect(scheduled.hours).toBe(2);

		const cancelled = service.cancelSchedule();
		expect(clearIntervalImpl).toHaveBeenCalledWith(timer);
		expect(cancelled).toEqual({ scheduled: false, hours: null, nextReloadAt: null });
	});

	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("非法 schedule hours=%s 抛错", (hours) => {
		const service = makeService(jest.fn() as unknown as typeof fetch);
		expect(() => service.schedule(hours)).toThrow("hours");
	});
});

describe("ModelCostMapService 价格补丁", () => {
	const overrides = {
		"opencode-go/patch-only": { input_cost_per_token: 0, output_cost_per_token: 0, mode: "chat" },
		"bundled-a": { output_cost_per_token: 9 },
	};

	function makePatchedService(fetchImpl: typeof fetch = jest.fn() as unknown as typeof fetch): ModelCostMapService {
		return new ModelCostMapService({
			bundledRawJson: JSON.stringify(bundledMap),
			overridesRawJson: JSON.stringify(overrides),
			fetchImpl: fetchImpl,
			env: { LITELLM_MODEL_COST_MAP_MIN_MODELS: "1", LITELLM_MODEL_COST_MAP_MIN_BUNDLED_RATIO: "0" },
		});
	}

	it("上游未收录的键整条补入，已收录的键只覆盖补丁字段", async () => {
		const service = makePatchedService();
		const snapshot = await service.initialize();

		expect(snapshot.map["opencode-go/patch-only"]).toMatchObject({ input_cost_per_token: 0, output_cost_per_token: 0 });
		// 补丁只改 output：未提到的 input 仍来自快照
		expect(snapshot.map["bundled-a"]).toMatchObject({ input_cost_per_token: 1, output_cost_per_token: 9 });
		expect(snapshot.modelCount).toBe(3);
	});

	it("远端快照同样合并补丁，而不是只对 bundled 生效", async () => {
		const remoteMap = { "remote-only": { input_cost_per_token: 5, output_cost_per_token: 6 } };
		const fetchImpl = jest
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify(remoteMap), { status: 200, headers: { "content-type": "application/json" } }),
			) as typeof fetch;
		const service = makePatchedService(fetchImpl);

		const snapshot = await service.initialize();

		expect(snapshot.source).toBe("remote");
		expect(snapshot.map["remote-only"]).toBeDefined();
		expect(snapshot.map["opencode-go/patch-only"]).toBeDefined();
	});

	it("补丁表格式非法时阻断构造", () => {
		expect(() => new ModelCostMapService({ bundledRawJson: JSON.stringify(bundledMap), overridesRawJson: '{"a": 1}' })).toThrow(
			"model cost overrides",
		);
	});

	it("仓库补丁表覆盖 opencode-go 目录里上游缺失的模型", async () => {
		const service = new ModelCostMapService({ bundledRawJson: JSON.stringify(bundledMap) });
		const snapshot = await service.initialize();
		const expected = {
			"opencode-go/hy4": [8.34e-7, 2.501e-6],
			"opencode-go/hy4-flash-free": [0, 0],
			"opencode-go/iceman-contributor-free": [0, 0],
			"opencode-go/longcat-2.5-free": [0, 0],
			"opencode-go/qwen4-max": [1.5e-6, 4.5e-6],
		};

		for (const [key, [input, output]] of Object.entries(expected)) {
			expect(snapshot.map[key]).toMatchObject({ input_cost_per_token: input, output_cost_per_token: output });
		}
	});
});
