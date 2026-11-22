/**
 * 把上游模型元信息合并进 model_info，并产出给 Dashboard 的上游信息块。
 *
 * 优先级（高→低）：部署配置 `model_info` > 内置价目表 / cost map > 上游元信息。
 * 只有前两者都没有时上游才补位，所以「配置了就用配置」是类型层面看得见的：本模块
 * 只填空值，从不覆盖已有值。被补位的字段名记进 `filled_fields`，前端据此显示「来自
 * 上游」的图标，而不是靠猜。
 */

import type { Deployment } from "../types/router";
import type { UpstreamModelMetaRecord, UpstreamModelMetadata } from "../subscriptions/native/upstream/types";
import { upstreamRefForDeployment, type UpstreamModelRef } from "../subscriptions/native/upstream/lookup";
import { getUpstreamModelInfoService } from "../subscriptions/native/upstream/runtime";

/** 上游字段 → model_info 字段。值统一用 LiteLLM 的 per-token / 布尔语义。 */
export const UPSTREAM_MODEL_INFO_FIELDS: ReadonlyArray<readonly [string, keyof UpstreamModelMetadata]> = [
	["max_input_tokens", "contextWindow"],
	["max_output_tokens", "maxOutputTokens"],
	["input_cost_per_token", "inputCostPerToken"],
	["output_cost_per_token", "outputCostPerToken"],
	["cache_read_input_token_cost", "cacheReadCostPerToken"],
	["cache_creation_input_token_cost", "cacheWriteCostPerToken"],
	["supports_vision", "supportsVision"],
	["supports_function_calling", "supportsTools"],
	["supports_reasoning", "supportsReasoning"],
	["supports_response_schema", "supportsStructuredOutput"],
];

/**
 * 用上游元信息填补 model_info 的空缺字段。
 * @param info - 已合并配置与价目表的 model_info（原地修改）
 * @param metadata - 上游归一化元信息
 * @returns 实际被上游补位的字段名
 */
export function applyUpstreamFills(info: Record<string, unknown>, metadata: UpstreamModelMetadata | undefined): string[] {
	if (metadata === undefined) {
		return [];
	}
	const filled: string[] = [];
	for (const [infoKey, metadataKey] of UPSTREAM_MODEL_INFO_FIELDS) {
		if (info[infoKey] !== null && info[infoKey] !== undefined) {
			continue;
		}
		const value = metadata[metadataKey];
		if (value === undefined) {
			continue;
		}
		info[infoKey] = value;
		filled.push(infoKey);
	}
	return filled;
}

/** Dashboard 展示用的上游信息块。 */
export interface UpstreamModelInfoPayload {
	/** 订阅来源。 */
	readonly source: UpstreamModelRef["source"];
	/** 上游模型 ID。 */
	readonly upstream_model: string;
	/** 上游展示名。 */
	readonly display_name?: string;
	/** 缓存状态；`ok` 以外没有可用的元信息。 */
	readonly status: UpstreamModelMetaRecord["status"];
	/** 是否已过期（仍展示旧值，后台在刷新）。 */
	readonly stale: boolean;
	/** 抓取时间（ISO）。 */
	readonly fetched_at: string;
	/** 过期时间（ISO）。 */
	readonly expires_at: string;
	/** 失败原因。 */
	readonly error?: string;
	/** 上游给出的 model_info 语义字段；没有值时为 null。 */
	readonly model_info: Record<string, unknown> | null;
	/** 归一化原始字段；给需要细节的界面用。 */
	readonly raw: UpstreamModelMetadata | null;
	/** 本次合并中实际由上游补位的 model_info 字段。 */
	readonly filled_fields: readonly string[];
}

/**
 * 把缓存记录转成 Dashboard 载荷。
 * @param ref - 上游键
 * @param record - 缓存记录
 * @param filledFields - 合并时被补位的字段
 */
export function buildUpstreamPayload(
	ref: UpstreamModelRef,
	record: UpstreamModelMetaRecord,
	filledFields: readonly string[],
): UpstreamModelInfoPayload {
	const metadata = record.status === "ok" ? record.metadata : undefined;
	const modelInfo: Record<string, unknown> = {};
	if (metadata !== undefined) {
		for (const [infoKey, metadataKey] of UPSTREAM_MODEL_INFO_FIELDS) {
			const value = metadata[metadataKey];
			if (value !== undefined) {
				modelInfo[infoKey] = value;
			}
		}
	}
	return {
		source: ref.source,
		upstream_model: ref.upstreamModel,
		display_name: record.displayName ?? metadata?.displayName,
		status: record.status,
		stale: record.expiresAt.getTime() <= Date.now(),
		fetched_at: record.fetchedAt.toISOString(),
		expires_at: record.expiresAt.toISOString(),
		error: record.error,
		model_info: Object.keys(modelInfo).length === 0 ? null : modelInfo,
		raw: metadata ?? null,
		filled_fields: filledFields,
	};
}

/**
 * 按部署取上游载荷；没有缓存记录时返回 undefined（Dashboard 不显示图标）。
 * @param deployment - 路由部署
 * @param filledFields - 合并时被补位的字段
 */
export function upstreamPayloadForDeployment(
	deployment: Deployment,
	filledFields: readonly string[],
): UpstreamModelInfoPayload | undefined {
	const ref = upstreamRefForDeployment(deployment);
	const service = getUpstreamModelInfoService();
	const record = ref === undefined ? undefined : service?.get(ref.source, ref.upstreamModel);
	return ref === undefined || record === undefined ? undefined : buildUpstreamPayload(ref, record, filledFields);
}
