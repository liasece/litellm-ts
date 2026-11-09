/**
 * CLIProxy 启动窗口的请求侧等待闸门。
 *
 * 网关监听不等托管 CLIProxy 就绪（见 `docs/startup.md`）。这在停机窗口上是收益，
 * 但窗口内所有走 CLIProxy 的请求都会立刻拿到连接错误，进而落到 Router 的 fallback 链：
 * 生产 2026-11-09 08:45 的启动窗口里，5 条 `commandcode/deepseek/deepseek-v4.1-flash`
 * 请求被静默换成了 `deepseek-v4-flash`，调用方拿到的模型与所请求的不一致。
 *
 * 这里给出一条比「换模型」更合适的路径：当请求解析到的模型组包含 CLIProxy deployment、
 * 且子进程仍在启动时，最多等待 `CLIPROXY_STARTUP_WAIT_MS`（默认 5 秒）让进程就绪，再继续
 * 原请求。等待有上限，启动失败、已停止、被禁用或超时都按原逻辑 fallback；
 * 升级排空阶段不等待（那时要的正是立刻降级）。
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createModuleLogger } from "../core/utils/logger";
import { isCliProxyDraining } from "./CliProxyDrainGate";
import type { CliProxyProcessState } from "./CliProxyTypes";

const logger = createModuleLogger("CliProxyStartupGate");

/** 启动窗口等待上限的环境变量（毫秒）；设为 0 关闭等待。 */
export const CLIPROXY_STARTUP_WAIT_ENV = "CLIPROXY_STARTUP_WAIT_MS";

/** 默认等待上限：稳态重启实测就绪约 1.8 秒，镜像刚替换的冷启动约 5~6 秒。 */
export const CLIPROXY_DEFAULT_STARTUP_WAIT_MS = 5_000;

/** 等待期间的状态轮询间隔：与排空闸门同量级，就绪后最多多等一个间隔。 */
export const CLIPROXY_STARTUP_POLL_INTERVAL_MS = 25;

/** 真正等过这么久才写日志，避免稳态请求刷屏。 */
const STARTUP_WAIT_LOG_THRESHOLD_MS = 20;

/** 启动闸门依赖的 Router 能力：模型组是否可能落到 CLIProxy deployment。 */
export interface CliProxyStartupGateRouter {
	/**
	 * @param model - 用户传入的模型名或 alias
	 */
	hasCliProxyDeploymentForModel(model: string): boolean;
}

/** 启动闸门依赖的运行时能力。 */
export interface CliProxyStartupGateRuntime {
	/**
	 * @param timeoutMs - 等待上限
	 */
	waitUntilReady(timeoutMs: number): Promise<boolean>;
}

/** 就绪探针：把运行时的状态与「启动是否仍在进行」交给等待函数，便于单测覆盖。 */
export interface CliProxyReadinessProbe {
	/** 当前进程状态。 */
	readonly readState: () => CliProxyProcessState;
	/** 启动是否仍在进行（还会变成 running）；为 false 表示继续等也没有意义。 */
	readonly isStartupInProgress: () => boolean;
	/** 等待上限（毫秒）。 */
	readonly timeoutMs: number;
	/** 轮询间隔（毫秒），默认 {@link CLIPROXY_STARTUP_POLL_INTERVAL_MS}。 */
	readonly pollIntervalMs?: number;
}

/**
 * 解析启动等待上限（毫秒）；非法或负数退回默认值，0 表示关闭等待。
 * @param env - 进程环境变量
 * @returns 等待上限（毫秒）
 */
export function resolveCliProxyStartupWaitMs(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env[CLIPROXY_STARTUP_WAIT_ENV];
	const value = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
	const effective = Number.isFinite(value) && value >= 0 ? value : CLIPROXY_DEFAULT_STARTUP_WAIT_MS;
	return Math.round(effective);
}

/**
 * 等待 CLIProxy 进入可服务状态。
 *
 * 已经在 `running` 时立即返回；启动已经结束（禁用、停止、崩溃循环、超时）时也立即返回 false，
 * 让调用方按原逻辑 fallback，不把请求拖到无意义的上限。
 * @param probe - 状态探针与等待上限
 * @returns 是否在期限内变为 `running`
 */
export async function waitForCliProxyReady(probe: CliProxyReadinessProbe): Promise<boolean> {
	const pollIntervalMs = Math.max(1, probe.pollIntervalMs ?? CLIPROXY_STARTUP_POLL_INTERVAL_MS);
	const deadline = Date.now() + Math.max(0, probe.timeoutMs);
	while (true) {
		if (probe.readState() === "running") {
			return true;
		}
		if (!probe.isStartupInProgress()) {
			return false;
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			return false;
		}
		await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remaining)));
	}
}

/**
 * 从请求体读出模型名；没有可路由的模型时返回 undefined。
 * @param req - Express 请求
 * @returns 请求体中的模型名（已 trim）
 */
function requestModel(req: Request): string | undefined {
	const body = req.body as { model?: unknown } | undefined;
	const model = body?.model;
	return typeof model === "string" && model.trim().length > 0 ? model.trim() : undefined;
}

/**
 * 构造启动窗口的等待中间件。
 *
 * 必须挂在绑定请求级运行时配置之后（需要 Router 的当前快照解析模型组）、路由处理器之前；
 * 对不含 CLIProxy deployment 的模型组与排空阶段是零开销直通。
 * @param router - Router 能力视图
 * @param runtime - 运行时能力视图
 * @param options - 可覆盖的等待上限（毫秒）
 * @returns Express 中间件
 */
export function cliProxyStartupGate(
	router: CliProxyStartupGateRouter,
	runtime: CliProxyStartupGateRuntime,
	options: { readonly timeoutMs?: number } = {},
): RequestHandler {
	const waitMs = options.timeoutMs ?? resolveCliProxyStartupWaitMs();
	return (req: Request, _res: Response, next: NextFunction): void => {
		const model = requestModel(req);
		// 排空阶段要的正是立刻降级；没有模型或组内不含 CLIProxy 时无需等待。
		if (waitMs <= 0 || model === undefined || isCliProxyDraining() || !router.hasCliProxyDeploymentForModel(model)) {
			next();
			return;
		}
		const startedAt = Date.now();
		runtime
			.waitUntilReady(waitMs)
			.then((ready) => {
				const waitedMs = Date.now() - startedAt;
				if (waitedMs < STARTUP_WAIT_LOG_THRESHOLD_MS) {
					return;
				}
				if (ready) {
					logger.info("CLIProxy 启动窗口内已就绪，继续使用请求的模型", { model: model, waitedMs: waitedMs });
					return;
				}
				logger.warn("CLIProxy 启动窗口内未就绪，按 fallback 继续", { model: model, waitedMs: waitedMs });
			})
			.catch((error: unknown) => {
				logger.warn("等待 CLIProxy 就绪失败，按原逻辑继续", { error: error, model: model });
			})
			.finally(() => {
				next();
			});
	};
}
