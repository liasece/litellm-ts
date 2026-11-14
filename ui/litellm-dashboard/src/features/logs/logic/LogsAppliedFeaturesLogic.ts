import type { LogEntry } from "../support/LogsModels";
import { record } from "./LogsPresentationLogic";

/**
 * Feature 列的展示口径。
 *
 * `id` 是后端写入 metadata 的稳定契约（见 `src/types/spend.ts` 的 `AppliedFeatureId`），
 * 图标、名称与排序只是它的展示层映射：后端新增能力时前端加一条映射即可，不需要改列结构；
 * 认不出的 id 直接忽略，老前端遇到新能力不会报错。
 */
export type AppliedFeatureTone = "privacy" | "redirect" | "resolve" | "params" | "select";

export interface AppliedFeatureDefinition {
	/** Lucide 图标名（UiLucideIconDefinitions.json 中的键） */
	icon: string;
	/** 同族共用的色系 */
	tone: AppliedFeatureTone;
	/** 悬停清单里的短名称 */
	label: string;
	/** 这个标记意味着什么 */
	description: string;
	/** 列内固定排序：数值越小越靠前 */
	priority: number;
}

const definitions: Record<string, AppliedFeatureDefinition> = {
	privacy: {
		icon: "ShieldCheck",
		tone: "privacy",
		label: "Privacy",
		description: "发生了敏感数据替换，发往上游的是占位符",
		priority: 10,
	},
	"privacy:blocked": {
		icon: "ShieldX",
		tone: "privacy",
		label: "Privacy blocked",
		description: "命中拒绝替换的规则，请求被拦下且没有发往上游",
		priority: 11,
	},
	fallback: {
		icon: "GitBranch",
		tone: "redirect",
		label: "Fallback",
		description: "首选模型失败后换到备用模型",
		priority: 20,
	},
	"fallback:context_window": {
		icon: "UnfoldVertical",
		tone: "redirect",
		label: "Context window fallback",
		description: "因上下文窗口超限换到备用模型",
		priority: 21,
	},
	"fallback:content_policy": {
		icon: "AlertTriangle",
		tone: "redirect",
		label: "Content policy fallback",
		description: "上游因内容策略拒绝后换到备用模型",
		priority: 22,
	},
	override: {
		icon: "CornerUpRight",
		tone: "resolve",
		label: "Model override",
		description: "override_model_name 强制把请求改投目标模型组",
		priority: 30,
	},
	alias: {
		icon: "Link2",
		tone: "resolve",
		label: "Alias",
		description: "请求的模型名经 alias 展开后执行",
		priority: 40,
	},
	"alias:scheduled": {
		icon: "CalendarClock",
		tone: "resolve",
		label: "Scheduled alias",
		description: "alias 按每日时段选中目标（峰谷价路由）",
		priority: 41,
	},
	"reasoning_effort:forced": {
		icon: "BrainCircuit",
		tone: "params",
		label: "Forced reasoning effort",
		description: "强制覆盖调用方的推理档位",
		priority: 50,
	},
	"reasoning_effort:default": {
		icon: "Brain",
		tone: "params",
		label: "Default reasoning effort",
		description: "调用方没有指定档位时补上默认值",
		priority: 51,
	},
	tag_routing: {
		icon: "Tags",
		tone: "select",
		label: "Tag routing",
		description: "按 metadata.tags 过滤候选 deployment",
		priority: 60,
	},
};

export interface AppliedFeatureBadge extends AppliedFeatureDefinition {
	/** 后端写入的原始 id */
	id: string;
	/** 具体取值，例如 `gpt-4o → claude-sonnet-4`、`high`、`EMAIL×2` */
	detail?: string;
	/** 同一能力在一次请求内的次数（替换处数、fallback 跳数） */
	count: number;
}

/**
 * 读取一行日志实际生效的能力标记。
 *
 * 服务端已经把现场记录与路由轨迹派生的 fallback 合并进 `metadata.applied_features`，
 * 前端只做展示映射；只有该键完全不存在的历史行，才在展示层从同一份 `routing_trace`
 * 就地派生，否则老日志这一列会全空。键存在但为 null 表示「确实没有能力生效」。
 * @param log - 日志行
 */
export function appliedFeatures(log: LogEntry): AppliedFeatureBadge[] {
	const metadata = record(log.metadata);
	const raw = metadata["applied_features"];
	if (raw === undefined) {
		return legacyFallback(metadata);
	}
	if (!Array.isArray(raw)) {
		return [];
	}
	const badges: AppliedFeatureBadge[] = [];
	const seen = new Set<string>();
	for (const entry of raw) {
		const item = record(entry),
			id = item["id"];
		if (typeof id !== "string" || seen.has(id)) continue;
		const definition = definitions[id];
		if (definition === undefined) continue;
		seen.add(id);
		const detail = typeof item["detail"] === "string" && item["detail"].length > 0 ? item["detail"] : undefined;
		const count = typeof item["count"] === "number" && Number.isFinite(item["count"]) ? Math.max(1, item["count"]) : 1;
		badges.push({ ...definition, id: id, detail: detail, count: count });
	}
	return badges.sort((left, right) => left.priority - right.priority);
}

/** `routing_trace.routing_type` 到 fallback 能力 id 的映射，与后端 `AppliedFeatures` 保持同一口径。 */
const FALLBACK_ID_BY_ROUTING_TYPE: Record<string, string> = {
	general_fallback: "fallback",
	context_window_fallback: "fallback:context_window",
	content_policy_fallback: "fallback:content_policy",
};

/**
 * 历史行的兜底：改造前落库的行没有 `applied_features`，但同期的 `routing_trace` 已经
 * 记了「第几跳因为什么换模型」，按它就地归并才不会把窗口超限写成普通 fallback。
 * 更早的行连轨迹都没有，只剩 `fallback_models` 的候选清单，只能给出一个通用 fallback。
 * @param metadata - 日志 metadata
 */
function legacyFallback(metadata: Record<string, unknown>): AppliedFeatureBadge[] {
	const derived = legacyFallbackFromTrace(metadata);
	if (derived.length > 0) {
		return derived;
	}
	const models = Array.isArray(metadata["fallback_models"])
		? metadata["fallback_models"].filter((value): value is string => typeof value === "string" && value.length > 0)
		: [];
	if (models.length < 2) {
		return [];
	}
	const definition = definitions["fallback"];
	return [
		{
			...definition,
			id: "fallback",
			detail: models[0] + " → " + models[models.length - 1],
			count: models.length - 1,
		},
	];
}

/**
 * 按 `routing_trace` 归并历史行的 fallback：同一类型的多跳合并成一条，详情取最后一跳。
 * @param metadata - 日志 metadata
 */
function legacyFallbackFromTrace(metadata: Record<string, unknown>): AppliedFeatureBadge[] {
	const trace = metadata["routing_trace"];
	if (!Array.isArray(trace)) {
		return [];
	}
	const grouped = new Map<string, { count: number; detail: string }>();
	for (const entry of trace) {
		const item = record(entry),
			id = FALLBACK_ID_BY_ROUTING_TYPE[String(item["routing_type"] ?? "")];
		if (id === undefined) continue;
		const from = typeof item["from_model"] === "string" ? item["from_model"] : "",
			to = typeof item["to_resolved_model"] === "string" ? item["to_resolved_model"] : "";
		const existing = grouped.get(id);
		grouped.set(id, {
			count: (existing?.count ?? 0) + 1,
			detail: from && to ? from + " → " + to : (existing?.detail ?? ""),
		});
	}
	const badges: AppliedFeatureBadge[] = [];
	for (const [id, entry] of grouped) {
		const definition = definitions[id];
		if (definition === undefined) continue;
		badges.push({ ...definition, id: id, detail: entry.detail || undefined, count: entry.count });
	}
	return badges.sort((left, right) => left.priority - right.priority);
}

/**
 * 悬停清单里的一行：名称 + 具体取值 + 次数。
 * @param badge - 能力标记
 */
export function appliedFeatureTooltip(badge: AppliedFeatureBadge): string {
	const parts = [badge.label + "：" + badge.description];
	if (badge.detail) parts.push(badge.detail);
	if (badge.count > 1) parts.push("共 " + badge.count + " 次");
	return parts.join("\n");
}
