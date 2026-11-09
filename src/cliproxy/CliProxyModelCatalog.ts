/**
 * CLIProxy 模型目录的就绪判定。
 *
 * `/healthz` 只说明 CPA 的 HTTP 服务已经在听。托管插件（OpenCode Go、CommandCode）是在
 * listen 之后才把自己的模型注册进目录的，这中间的几百毫秒到几秒里，带插件前缀的模型会被
 * CPA 判成 `model_not_found / unknown provider`，网关只能吃一次 400 再走 fallback。
 * 2026-11-09 的两次重启（发布与受控重启）都在这个尾部各丢了一次首请求。
 *
 * 这里用 `/v1/models` 是否已经列出「插件前缀下的模型」来判定模型可解析，把「就绪」从
 * 「进程健康」补全到「路由目标能解析」。判定失败只降级为日志，不阻断启动：目录还没好时
 * 请求仍可由 Router fallback 兜底。
 */

import type { CliProxyManagedPlugins } from "./CliProxyRuntimeManager";

/** OpenCode Go 插件的模型前缀（与 CPA 插件配置里的 model-prefix 保持一致）。 */
export const OPENCODE_GO_MODEL_PREFIX = "opencode-go";

/** CommandCode 插件的模型前缀。 */
export const COMMANDCODE_MODEL_PREFIX = "commandcode";

/** 模型目录轮询间隔：与健康轮询同量级。 */
export const MODEL_CATALOG_POLL_INTERVAL_MS = 50;

/** 模型目录等待上限：线上实测插件注册在健康后 0.3~2 秒内完成，留一倍余量后放弃。 */
export const MODEL_CATALOG_TIMEOUT_MS = 3_000;

/** 等待模型目录就绪的探针。 */
export interface CliProxyModelCatalogProbe {
	/** 需要出现的模型前缀（来自已启用的托管插件）。 */
	readonly prefixes: readonly string[];
	/** 读取 CPA 当前可解析的模型 id 列表。 */
	readonly fetchModelIds: () => Promise<readonly string[]>;
	/** 是否已经不需要继续等（停机意图或子进程退出）。 */
	readonly isAborted: () => boolean;
	/** 等待上限（毫秒）。 */
	readonly timeoutMs: number;
	/** 轮询间隔（毫秒），默认 {@link MODEL_CATALOG_POLL_INTERVAL_MS}。 */
	readonly pollIntervalMs?: number;
}

/** 模型目录等待结果。 */
export interface CliProxyModelCatalogWaitResult {
	/** 前缀模型是否都已在目录中。 */
	readonly ready: boolean;
	/** 是否因为停机/进程退出而提前结束。 */
	readonly aborted: boolean;
	/** 实际等待时长（毫秒）。 */
	readonly waitedMs: number;
	/** 超时后仍缺失的前缀。 */
	readonly missing: readonly string[];
}

/**
 * 列出当前配置下应等待的插件模型前缀。
 * @param plugins - 本次投影启用的托管插件；null 表示没有托管插件
 * @returns 需要出现在模型目录里的前缀
 */
export function expectedModelPrefixes(plugins: CliProxyManagedPlugins | null): string[] {
	const prefixes: string[] = [];
	if (plugins?.opencodeGo) {
		prefixes.push(OPENCODE_GO_MODEL_PREFIX);
	}
	if (plugins?.commandcode) {
		prefixes.push(COMMANDCODE_MODEL_PREFIX);
	}
	return prefixes;
}

/**
 * 从 `/v1/models` 的响应里取出模型 id。
 *
 * 兼容 CPA 的 OpenAI 风格 `{data:[{id}]}`、插件信封 `{models:[{id}]}` 与裸数组；
 * 无法识别的条目直接忽略，返回去重后的非空 id。
 * @param payload - 已解析的响应体
 * @returns 模型 id 列表
 */
export function extractModelIds(payload: unknown): string[] {
	const entries = Array.isArray(payload)
		? payload
		: isRecord(payload) && Array.isArray(payload["data"])
			? payload["data"]
			: isRecord(payload) && Array.isArray(payload["models"])
				? payload["models"]
				: [];
	const ids = new Set<string>();
	for (const entry of entries) {
		const id = typeof entry === "string" ? entry : isRecord(entry) ? (entry["id"] ?? entry["name"]) : undefined;
		if (typeof id === "string" && id.trim().length > 0) {
			ids.add(id.trim());
		}
	}
	return [...ids];
}

/**
 * 判断哪些前缀还没有出现在模型目录里。
 * @param ids - 模型 id 列表
 * @param prefixes - 需要出现的前缀
 * @returns 缺失的前缀（顺序与入参一致）
 */
export function missingModelPrefixes(ids: readonly string[], prefixes: readonly string[]): string[] {
	return prefixes.filter((prefix) => !ids.some((id) => id === prefix || id.startsWith(`${prefix}/`)));
}

/**
 * 轮询等待插件前缀的模型出现在模型目录里。
 *
 * 读取失败按「还没就绪」处理继续轮询；停机或子进程退出则立即返回 aborted，
 * 不让启动流程在已经没人需要的进程上空转。
 * @param probe - 前缀、读取函数与等待上限
 * @returns 就绪/中止/超时的结果
 */
export async function waitForModelCatalog(probe: CliProxyModelCatalogProbe): Promise<CliProxyModelCatalogWaitResult> {
	const startedAt = Date.now();
	const pollIntervalMs = Math.max(1, probe.pollIntervalMs ?? MODEL_CATALOG_POLL_INTERVAL_MS);
	const deadline = startedAt + Math.max(0, probe.timeoutMs);
	if (probe.prefixes.length === 0) {
		return { ready: true, aborted: false, waitedMs: 0, missing: [] };
	}
	while (true) {
		if (probe.isAborted()) {
			return { ready: false, aborted: true, waitedMs: Date.now() - startedAt, missing: [] };
		}
		let ids: readonly string[] = [];
		try {
			ids = await probe.fetchModelIds();
		} catch {
			ids = [];
		}
		const missing = missingModelPrefixes(ids, probe.prefixes);
		if (missing.length === 0) {
			return { ready: true, aborted: false, waitedMs: Date.now() - startedAt, missing: [] };
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			return { ready: false, aborted: false, waitedMs: Date.now() - startedAt, missing: missing };
		}
		await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remaining)));
	}
}

/**
 * 是否为普通对象。
 * @param value - 待判断值
 * @returns 是否对象
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
