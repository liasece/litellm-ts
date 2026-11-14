/**
 * 请求级的「能力标记」账本。
 *
 * 日志里的 Feature 列要回答「这条请求被我们路由的哪些能力处理过」，而这些事实分散在
 * 几个改写点上：隐私脱敏、推理档位注入、alias / override 解析、tag 过滤。它们都在请求
 * 深处被调用，且同一个函数还被后台任务、健康检查、能力探测复用，因此不把采集器一路
 * 穿进调用链，而是按请求开一个 AsyncLocalStorage 作用域，谁改写了请求就在现场记一笔。
 *
 * 与 `upstreamExchangeScope` 同一套做法：作用域外调用静默忽略，遗留路径与既有测试
 * 因此不需要跟着改；内置能力的内部调用必须开子作用域，否则 worker 的 fallback 会被
 * 记到外层用户请求上。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { AppliedFeatureId, AppliedFeatureRecord } from "../types/spend";
import type { ModelGroupResolution, RoutingTraceEntry } from "./ModelResolutionTrace";

/**
 * 一次请求最多记录的能力条数。
 *
 * 账本按 id 归并，正常请求不会超过 10 条；上限只用于兜住「配置里出现大量不同
 * override 边」这类异常输入，避免 metadata 体积失控。
 */
const MAX_APPLIED_FEATURES = 32;

/** 现场记录的一条能力；`count` 省略表示 1 次。 */
export interface AppliedFeatureNote {
	/** 能力标识 */
	readonly id: AppliedFeatureId;
	/** 面向人的具体取值 */
	readonly detail?: string;
	/** 次数（替换处数、fallback 跳数） */
	readonly count?: number;
}

/** 账本本体；按插入顺序保存，便于输出与人读的先后一致。 */
interface AppliedFeatureLedger {
	readonly byId: Map<AppliedFeatureId, AppliedFeatureRecord>;
}

const ledgers = new AsyncLocalStorage<AppliedFeatureLedger>();

/**
 * 在一个新的能力账本里执行，通常包住一次 HTTP 请求。
 * @template T - 回调返回类型
 * @param callback - 在该作用域内执行的逻辑
 * @returns 回调返回值
 */
export function runWithAppliedFeatures<T>(callback: () => T): T {
	return ledgers.run({ byId: new Map() }, callback);
}

/**
 * 记录一条能力；没有请求作用域时静默忽略（后台任务、健康检查、单元测试）。
 *
 * 同一 id 只保留一条：重复出现时取更大的次数，并在次数增长时用最新的 detail
 * 覆盖（例如脱敏统计会随着多次上游尝试累积，后者更完整）；次数没变的重复出现的
 * detail 保持首次值，避免 fallback 换模型的多次解析把同一条记录改来改去。
 * @param note - 要记录的能力
 */
export function noteAppliedFeature(note: AppliedFeatureNote): void {
	const ledger = ledgers.getStore();
	if (ledger === undefined) {
		return;
	}
	const count = note.count ?? 1;
	const existing = ledger.byId.get(note.id);
	if (existing === undefined) {
		if (ledger.byId.size >= MAX_APPLIED_FEATURES) {
			return;
		}
		ledger.byId.set(note.id, {
			id: note.id,
			...(note.detail ? { detail: note.detail } : {}),
			...(count > 1 ? { count: count } : {}),
		});
		return;
	}
	if (count > (existing.count ?? 1)) {
		ledger.byId.set(note.id, {
			id: note.id,
			...(note.detail ? { detail: note.detail } : {}),
			...(count > 1 ? { count: count } : {}),
		});
	}
}

/**
 * 读取当前请求已记录的能力标记。
 * @returns 没有作用域或没有记录时返回 undefined
 */
export function snapshotAppliedFeatures(): AppliedFeatureRecord[] | undefined {
	const ledger = ledgers.getStore();
	if (ledger === undefined || ledger.byId.size === 0) {
		return undefined;
	}
	return [...ledger.byId.values()];
}

/**
 * 记录一次已执行的模型组解析跨过的 alias / override 边。
 *
 * 只在真正执行的那次解析后调用：fallback 链在计算候选时也会解析 alias，
 * 那些目标未必执行，提前记账会把「计划」写成「发生」。
 * @param resolution - FallbackHandler 返回的解析结果
 */
export function noteResolutionAppliedFeatures(resolution: ModelGroupResolution): void {
	for (const hop of resolution.hops ?? []) {
		noteAppliedFeature({ id: hop.kind, detail: `${hop.from} → ${hop.to}` });
	}
}

/** `routing_trace.routing_type` 到能力 id 的映射。 */
const FALLBACK_FEATURE_BY_ROUTING_TYPE: Record<RoutingTraceEntry["routing_type"], AppliedFeatureId> = {
	general_fallback: "fallback",
	context_window_fallback: "fallback:context_window",
	content_policy_fallback: "fallback:content_policy",
};

/**
 * 从路由轨迹派生 fallback 能力标记。
 *
 * fallback 不单独埋点：`routing_trace` 已经是这条事实的唯一事实源，详情抽屉也读它。
 * 再从决策现场记一遍只会制造两套口径，所以落账时按 routing_type 归并即可。
 * @param trace - 请求级路由轨迹
 * @returns 按首次出现顺序排列的 fallback 标记
 */
export function deriveFallbackAppliedFeatures(trace: readonly RoutingTraceEntry[]): AppliedFeatureRecord[] {
	const grouped = new Map<AppliedFeatureId, { count: number; detail: string }>();
	for (const entry of trace) {
		const id = FALLBACK_FEATURE_BY_ROUTING_TYPE[entry.routing_type];
		if (id === undefined) {
			continue;
		}
		const detail = `${entry.from_model} → ${entry.to_resolved_model}`;
		const existing = grouped.get(id);
		grouped.set(id, { count: (existing?.count ?? 0) + 1, detail: detail });
	}
	return [...grouped].map(([id, entry]) => ({ id: id, detail: entry.detail, count: entry.count }));
}

/**
 * 合并现场记录与派生的 fallback 标记，作为 metadata 的最终取值。
 *
 * 现场记录在前（alias / override / 档位发生在执行前，读起来与时间顺序一致），
 * fallback 派生在后；同 id 不重复。
 * @param notes - 账本快照
 * @param trace - 请求级路由轨迹
 * @returns 没有任何能力时返回 undefined
 */
export function mergeAppliedFeatures(
	notes: readonly AppliedFeatureRecord[] | undefined,
	trace: readonly RoutingTraceEntry[],
): AppliedFeatureRecord[] | undefined {
	const merged: AppliedFeatureRecord[] = [];
	const seen = new Set<AppliedFeatureId>();
	for (const note of notes ?? []) {
		if (seen.has(note.id)) {
			continue;
		}
		seen.add(note.id);
		merged.push(note);
	}
	for (const derived of deriveFallbackAppliedFeatures(trace)) {
		if (seen.has(derived.id)) {
			continue;
		}
		seen.add(derived.id);
		merged.push(derived);
	}
	return merged.length > 0 ? merged : undefined;
}
