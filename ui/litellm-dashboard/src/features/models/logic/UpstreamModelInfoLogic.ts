/**
 * `/model/upstream_info` 客户端与进程内缓存。
 *
 * 日志、用量、fallback 编辑器只知道模型组名，拿不到 deployment；它们通过这个按名字取
 * 的接口懒加载上游信息。同一模型只请求一次（含并发去重），失败也缓存为空结果，避免
 * 每次 hover 都打后端。
 */

import { requestJson } from "../../platform/api/HttpApiClient";
import type { UpstreamModelInfoEntry, UpstreamModelInfoPayload } from "../support/UpstreamModelInfoModels";

const cache = new Map<string, readonly UpstreamModelInfoPayload[]>();
const inflight = new Map<string, Promise<readonly UpstreamModelInfoPayload[]>>();

/**
 * 读取一个模型组的全部上游信息块（只保留有信息的部署）。
 * @param model - 模型组名或部署 id
 */
export async function ensureUpstreamModelInfo(model: string): Promise<readonly UpstreamModelInfoPayload[]> {
	const key = model.trim();
	if (key === "") {
		return [];
	}
	const cached = cache.get(key);
	if (cached !== undefined) {
		return cached;
	}
	const pending = inflight.get(key);
	if (pending !== undefined) {
		return pending;
	}
	const task = requestJson<{ data?: UpstreamModelInfoEntry[] }>(`/model/upstream_info?model=${encodeURIComponent(key)}`)
		.then((body) => {
			const payloads = (body.data ?? [])
				.map((entry) => entry.upstream_model_info)
				.filter((payload): payload is UpstreamModelInfoPayload => payload !== null);
			cache.set(key, payloads);
			return payloads;
		})
		.catch(() => {
			// 提示信息不是关键路径：失败按「没有上游信息」处理，不打扰用户。
			cache.set(key, []);
			return [] as readonly UpstreamModelInfoPayload[];
		})
		.finally(() => {
			inflight.delete(key);
		});
	inflight.set(key, task);
	return task;
}

/**
 * 同步读取已缓存的结果（不发起请求）。
 * @param model - 模型组名
 */
export function peekUpstreamModelInfo(model: string): readonly UpstreamModelInfoPayload[] {
	return cache.get(model.trim()) ?? [];
}

/**
 * 从多条部署记录里选主记录：优先 ok 状态，其次有更多字段的。
 * @param payloads - 上游信息块
 * @param upstreamModel - 期望的上游模型 ID（可选）
 */
export function pickUpstreamModelInfo(
	payloads: readonly UpstreamModelInfoPayload[],
	upstreamModel?: string,
): UpstreamModelInfoPayload | undefined {
	if (payloads.length === 0) {
		return undefined;
	}
	const preferred = upstreamModel === undefined ? undefined : payloads.find((payload) => payload.upstream_model === upstreamModel);
	if (preferred !== undefined) {
		return preferred;
	}
	const ok = payloads.find((payload) => payload.status === "ok" && payload.model_info !== null);
	return ok ?? payloads[0];
}

/** 清空缓存；测试与切换账号场景使用。 */
export function resetUpstreamModelInfoCache(): void {
	cache.clear();
	inflight.clear();
}
