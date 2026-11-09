import type { NextFunction, Request, Response } from "express";
import { beginCliProxyDrain, endCliProxyDrain, resetCliProxyDrainGateForTest } from "./CliProxyDrainGate";
import {
	CLIPROXY_DEFAULT_STARTUP_WAIT_MS,
	CLIPROXY_STARTUP_WAIT_ENV,
	cliProxyStartupGate,
	resolveCliProxyStartupWaitMs,
	waitForCliProxyReady,
} from "./CliProxyStartupGate";
import type { CliProxyProcessState } from "./CliProxyTypes";

describe("waitForCliProxyReady", () => {
	it("running 时立即返回，不进入等待", async () => {
		let startupInProgress = true;
		const startedAt = Date.now();
		await expect(
			waitForCliProxyReady({
				readState: () => "running",
				isStartupInProgress: () => startupInProgress,
				timeoutMs: 1_000,
			}),
		).resolves.toBe(true);
		expect(Date.now() - startedAt).toBeLessThan(20);
		expect(startupInProgress).toBe(true);
	});

	it("starting 期间等待，就绪后返回 true", async () => {
		let state: CliProxyProcessState = "starting";
		const waiting = waitForCliProxyReady({
			readState: () => state,
			isStartupInProgress: () => state === "starting",
			timeoutMs: 1_000,
			pollIntervalMs: 5,
		});
		await new Promise((resolve) => setTimeout(resolve, 30));
		state = "running";
		await expect(waiting).resolves.toBe(true);
	});

	it("启动已不再进行（stopped）时立即返回 false，不空等到超时", async () => {
		const startedAt = Date.now();
		await expect(
			waitForCliProxyReady({
				readState: () => "stopped",
				isStartupInProgress: () => false,
				timeoutMs: 5_000,
			}),
		).resolves.toBe(false);
		expect(Date.now() - startedAt).toBeLessThan(20);
	});

	it("启动中途失败（degraded）时提前返回 false", async () => {
		let state: CliProxyProcessState = "starting";
		const waiting = waitForCliProxyReady({
			readState: () => state,
			isStartupInProgress: () => state === "starting",
			timeoutMs: 5_000,
			pollIntervalMs: 5,
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		state = "degraded";
		await expect(waiting).resolves.toBe(false);
	});

	it("始终未就绪时在超时后返回 false", async () => {
		const startedAt = Date.now();
		await expect(
			waitForCliProxyReady({
				readState: () => "starting",
				isStartupInProgress: () => true,
				timeoutMs: 40,
				pollIntervalMs: 5,
			}),
		).resolves.toBe(false);
		expect(Date.now() - startedAt).toBeGreaterThanOrEqual(35);
	});
});

describe("resolveCliProxyStartupWaitMs", () => {
	it("缺省与非法值都退回默认上限", () => {
		expect(resolveCliProxyStartupWaitMs({})).toBe(CLIPROXY_DEFAULT_STARTUP_WAIT_MS);
		expect(resolveCliProxyStartupWaitMs({ [CLIPROXY_STARTUP_WAIT_ENV]: " " })).toBe(CLIPROXY_DEFAULT_STARTUP_WAIT_MS);
		expect(resolveCliProxyStartupWaitMs({ [CLIPROXY_STARTUP_WAIT_ENV]: "abc" })).toBe(CLIPROXY_DEFAULT_STARTUP_WAIT_MS);
		expect(resolveCliProxyStartupWaitMs({ [CLIPROXY_STARTUP_WAIT_ENV]: "-1" })).toBe(CLIPROXY_DEFAULT_STARTUP_WAIT_MS);
	});

	it("读取显式上限，0 表示关闭等待", () => {
		expect(resolveCliProxyStartupWaitMs({ [CLIPROXY_STARTUP_WAIT_ENV]: "1200" })).toBe(1_200);
		expect(resolveCliProxyStartupWaitMs({ [CLIPROXY_STARTUP_WAIT_ENV]: "0" })).toBe(0);
	});
});

function requestWithModel(model?: string): Request {
	return { body: model === undefined ? {} : { model: model } } as unknown as Request;
}

/** 运行中间件并等待它调用 next()。 */
async function runGate(gate: (req: Request, res: Response, next: NextFunction) => void, req: Request): Promise<void> {
	await new Promise<void>((resolve) => {
		gate(req, {} as Response, (() => resolve()) as NextFunction);
	});
}

function cliproxyWaitDouble(waitImpl: jest.Mock): {
	router: { hasCliProxyDeploymentForModel: jest.Mock };
	runtime: { waitUntilReady: jest.Mock };
} {
	return {
		router: { hasCliProxyDeploymentForModel: jest.fn(() => true) },
		runtime: { waitUntilReady: waitImpl },
	};
}

describe("cliProxyStartupGate", () => {
	afterEach(() => {
		resetCliProxyDrainGateForTest();
	});

	it("模型组含 CLIProxy deployment 时等待就绪再放行", async () => {
		const wait = jest.fn(async () => true);
		const { router, runtime } = cliproxyWaitDouble(wait);
		const gate = cliProxyStartupGate(router, runtime);

		await runGate(gate, requestWithModel("commandcode/deepseek/deepseek-v4.1-flash"));

		expect(router.hasCliProxyDeploymentForModel).toHaveBeenCalledWith("commandcode/deepseek/deepseek-v4.1-flash");
		expect(wait).toHaveBeenCalledTimes(1);
		expect(wait).toHaveBeenCalledWith(CLIPROXY_DEFAULT_STARTUP_WAIT_MS);
	});

	it("不含 CLIProxy 的模型组不等，直接放行", async () => {
		const wait = jest.fn(async () => true);
		const { runtime } = cliproxyWaitDouble(wait);
		const gate = cliProxyStartupGate({ hasCliProxyDeploymentForModel: jest.fn(() => false) }, runtime);

		await runGate(gate, requestWithModel("gpt-5.4"));

		expect(wait).not.toHaveBeenCalled();
	});

	it("排空阶段不等待：此时要的正是立刻 fallback", async () => {
		const wait = jest.fn(async () => true);
		const { router, runtime } = cliproxyWaitDouble(wait);
		const gate = cliProxyStartupGate(router, runtime);

		beginCliProxyDrain();
		try {
			await runGate(gate, requestWithModel("commandcode/deepseek/deepseek-v4.1-flash"));
		} finally {
			endCliProxyDrain();
		}

		expect(wait).not.toHaveBeenCalled();
	});

	it("没有模型名时直接放行", async () => {
		const wait = jest.fn(async () => true);
		const { router, runtime } = cliproxyWaitDouble(wait);
		const gate = cliProxyStartupGate(router, runtime);

		await runGate(gate, requestWithModel());

		expect(router.hasCliProxyDeploymentForModel).not.toHaveBeenCalled();
		expect(wait).not.toHaveBeenCalled();
	});

	it("等待上限为 0 时退化为不等待", async () => {
		const wait = jest.fn(async () => true);
		const { router, runtime } = cliproxyWaitDouble(wait);
		const gate = cliProxyStartupGate(router, runtime, { timeoutMs: 0 });

		await runGate(gate, requestWithModel("commandcode/deepseek/deepseek-v4.1-flash"));

		expect(wait).not.toHaveBeenCalled();
	});

	it("等待失败（超时或运行时异常）也必须继续请求，不能卡住", async () => {
		const wait = jest.fn(async () => {
			throw new Error("boom");
		});
		const { router, runtime } = cliproxyWaitDouble(wait);
		const gate = cliProxyStartupGate(router, runtime);

		await expect(runGate(gate, requestWithModel("commandcode/deepseek/deepseek-v4.1-flash"))).resolves.toBeUndefined();
		expect(wait).toHaveBeenCalledTimes(1);
	});
});
