import {
	awaitCliProxyIdle,
	beginCliProxyDrain,
	endCliProxyDrain,
	enterCliProxyRequest,
	getCliProxyDrainSnapshot,
	isCliProxyDraining,
	resetCliProxyDrainGateForTest,
	resolveCliProxyDrainTimeoutMs,
	trackCliProxyRequest,
	withCliProxyDrain,
} from "./CliProxyDrainGate";

/**
 * 升级 CLIProxy 前必须「先降级、再排空、最后重启」。
 * 这里验证闸门的可观察契约：拒绝新请求、等在途结束、超时不阻塞升级、失败也退出降级。
 */
describe("CLIProxy drain gate", () => {
	beforeEach(() => {
		resetCliProxyDrainGateForTest();
	});

	afterEach(() => {
		resetCliProxyDrainGateForTest();
	});

	it("rejects new direct requests while draining but still tracks admitted ones", () => {
		expect(isCliProxyDraining()).toBe(false);
		const release = enterCliProxyRequest();
		expect(getCliProxyDrainSnapshot().in_flight_requests).toBe(1);

		beginCliProxyDrain();
		expect(isCliProxyDraining()).toBe(true);
		expect(() => enterCliProxyRequest()).toThrow(/正在升级/);
		expect(getCliProxyDrainSnapshot().in_flight_requests).toBe(1);

		release();
		expect(getCliProxyDrainSnapshot().in_flight_requests).toBe(0);
		endCliProxyDrain();
		expect(isCliProxyDraining()).toBe(false);
		expect(() => enterCliProxyRequest()).not.toThrow();
	});

	it("waits for in-flight work to finish before running the restart", async () => {
		const release = trackCliProxyRequest();
		const order: string[] = [];
		const restart = withCliProxyDrain(
			async () => {
				order.push("restart");
			},
			{ probe: () => 0, timeoutMs: 2_000 },
		);

		setTimeout(() => {
			order.push("drained");
			release();
		}, 60);
		await restart;
		expect(order).toEqual(["drained", "restart"]);
		expect(isCliProxyDraining()).toBe(false);
	});

	it("counts Router-side in-flight requests through the probe", async () => {
		let routerSide = 2;
		const settled: Array<{ idle: boolean; remaining: number }> = [];
		const restart = withCliProxyDrain(async () => undefined, {
			probe: () => routerSide,
			timeoutMs: 2_000,
			onSettled: (result) => settled.push({ idle: result.idle, remaining: result.remaining }),
		});
		setTimeout(() => {
			routerSide = 0;
		}, 60);
		await restart;
		expect(settled).toEqual([{ idle: true, remaining: 0 }]);
	});

	it("gives up waiting after the timeout and still restarts (fallback covers truncation)", async () => {
		const release = trackCliProxyRequest();
		const settled: Array<{ idle: boolean; remaining: number }> = [];
		const started = Date.now();
		await withCliProxyDrain(async () => undefined, {
			probe: () => 0,
			timeoutMs: 80,
			onSettled: (result) => settled.push({ idle: result.idle, remaining: result.remaining }),
		});
		release();
		expect(Date.now() - started).toBeLessThan(2_000);
		expect(settled).toEqual([{ idle: false, remaining: 1 }]);
		expect(isCliProxyDraining()).toBe(false);
	});

	it("always leaves the drain state even when the restart fails", async () => {
		await expect(
			withCliProxyDrain(
				async () => {
					throw new Error("spawn failed");
				},
				{ probe: () => 0, timeoutMs: 0 },
			),
		).rejects.toThrow("spawn failed");
		expect(isCliProxyDraining()).toBe(false);
	});

	it("reports idle immediately when nothing is in flight", async () => {
		const result = await awaitCliProxyIdle(() => 0, 5_000);
		expect(result).toMatchObject({ idle: true, remaining: 0 });
	});

	it("resolves the drain timeout from the environment with a safe default", () => {
		expect(resolveCliProxyDrainTimeoutMs({} as NodeJS.ProcessEnv)).toBe(120_000);
		expect(resolveCliProxyDrainTimeoutMs({ CLIPROXY_DRAIN_TIMEOUT_SECONDS: "90" } as NodeJS.ProcessEnv)).toBe(90_000);
		expect(resolveCliProxyDrainTimeoutMs({ CLIPROXY_DRAIN_TIMEOUT_SECONDS: "0" } as NodeJS.ProcessEnv)).toBe(0);
		expect(resolveCliProxyDrainTimeoutMs({ CLIPROXY_DRAIN_TIMEOUT_SECONDS: "abc" } as NodeJS.ProcessEnv)).toBe(120_000);
	});
});
