/**
 * OpenCode Go 的模型元信息。
 *
 * 上游 `GET /models` 返回 32 个条目，元信息最丰富：`limit.context` / `limit.output`、
 * 百万 token 单价（`cost.text.input.price`、`cost.text.output.price`、缓存读取
 * `cost.text.input.cache.read`）、`capabilities`（tools / reasoning.effort /
 * structured_output）与多模态列表。价格单位是每百万 token，这里换算成 per-token，
 * 与 `model_info.input_cost_per_token` 对齐。
 */

import { OPENCODE_API_BASE } from "../catalog/dynamicCatalog";
import type { SubscriptionAccount } from "../types";
import { asNumber, asRecord, asText, asTextArray, compactMetadata, extractEntries, firstDefined, perMillionToPerToken } from "./normalize";
import { fetchUpstreamJson } from "./http";
import type { UpstreamModelMetadata, UpstreamModelMetadataMap, UpstreamSourceAdapter, UpstreamSourceFetchContext } from "./types";

/** 上游模型列表路径。 */
const MODELS_PATH = "/models";

/**
 * 从原始条目解析出归一化元信息。
 * @param entry
 */
function parseEntry(entry: unknown): { id: string; metadata: UpstreamModelMetadata } | undefined {
	const record = asRecord(entry);
	if (!record) {
		return undefined;
	}
	const id = asText(record["id"]) ?? asText(record["name"]);
	if (!id) {
		return undefined;
	}
	const limit = asRecord(record["limit"]);
	const cost = asRecord(record["cost"]);
	const textCost = asRecord(cost?.["text"]);
	const inputCost = asRecord(textCost?.["input"]);
	const inputCache = asRecord(inputCost?.["cache"]);
	const outputCost = asRecord(textCost?.["output"]);
	const capabilities = asRecord(record["capabilities"]);
	const tools = asRecord(capabilities?.["tools"]);
	const reasoning = asRecord(capabilities?.["reasoning"]);
	const modalities = asRecord(record["modalities"]);
	const inputModalities = asTextArray(modalities?.["input"]);
	const outputModalities = asTextArray(modalities?.["output"]);

	const metadata = compactMetadata({
		displayName: asText(record["name"]) ?? asText(record["display_name"]),
		description: asText(record["description"]),
		contextWindow: asNumber(limit?.["context"]),
		maxOutputTokens: asNumber(limit?.["output"]),
		// 上游价格单位是「每百万 token」，与 per-token 字段差 1e6。
		inputCostPerToken: perMillionToPerToken(asNumber(inputCost?.["price"])),
		outputCostPerToken: perMillionToPerToken(asNumber(outputCost?.["price"])),
		cacheReadCostPerToken: perMillionToPerToken(
			firstDefined([() => asNumber(inputCache?.["read"]), () => asNumber(inputCache?.["price"])]),
		),
		cacheWriteCostPerToken: perMillionToPerToken(
			firstDefined([() => asNumber(inputCache?.["write"]), () => asNumber(inputCache?.["creation"])]),
		),
		supportsTools: typeof tools?.["supported"] === "boolean" ? (tools["supported"] as boolean) : undefined,
		supportsReasoning: typeof reasoning?.["supported"] === "boolean" ? (reasoning["supported"] as boolean) : undefined,
		supportsStructuredOutput:
			typeof capabilities?.["structured_output"] === "boolean" ? (capabilities["structured_output"] as boolean) : undefined,
		supportsVision: inputModalities === undefined ? undefined : inputModalities.some((item) => item.startsWith("image")),
		inputModalities: inputModalities,
		outputModalities: outputModalities,
		reasoningLevels: asTextArray(reasoning?.["effort"]),
		family: asText(record["family"]),
		canonicalId: asText(record["canonical_id"]),
		releaseDate: asText(record["release_date"]),
	});
	return metadata === undefined ? undefined : { id: id, metadata: metadata };
}

/** OpenCode Go 适配器。 */
export const opencodeUpstreamAdapter: UpstreamSourceAdapter = {
	source: "opencode-go",
	supported: true,

	hasCredential: function (account: SubscriptionAccount): boolean {
		return asText(asRecord(account.raw)?.["api_key"]) !== undefined;
	},

	list: async function (context: UpstreamSourceFetchContext): Promise<readonly unknown[] | null> {
		const key = asText(asRecord(context.account.raw)?.["api_key"]);
		if (key === undefined) {
			return null;
		}
		const result = await fetchUpstreamJson(
			`${OPENCODE_API_BASE}${MODELS_PATH}`,
			{ method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } },
			context.fetchImpl,
			context.timeoutMs,
		);
		if (!result.ok) {
			throw new Error(result.error);
		}
		return extractEntries(result.payload, ["data", "models"]);
	},

	parse: function (entries: readonly unknown[]): UpstreamModelMetadataMap {
		const map = new Map<string, UpstreamModelMetadata>();
		for (const entry of entries) {
			const parsed = parseEntry(entry);
			if (parsed !== undefined) {
				map.set(parsed.id, parsed.metadata);
			}
		}
		return map;
	},
};
