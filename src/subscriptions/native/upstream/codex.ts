/**
 * Codex（ChatGPT 订阅）的模型元信息。
 *
 * 上游 `GET {base}/models?client_version=…` 返回 `{models: [...]}`，每条的 `slug` 是
 * 上游模型 ID，元信息有 `context_window`（当前生效窗口）、`max_context_window`
 * （模型理论上限）、`input_modalities`、`supported_reasoning_levels[].effort`、
 * `display_name` 与 `description`。
 *
 * 上游**没有**单次最大输出字段（`truncation_policy.limit` 是截断策略，不是输出上限），
 * 也不提供价格，因此 `maxOutputTokens` / 成本保持缺省，由模型配置或静态目录兜底。
 * 条目里的 `base_instructions` 是大段提示词，入库前由 `slimRawEntry` 剔除。
 */

import type { SubscriptionAccount } from "../types";
import { asNumber, asRecord, asText, asTextArray, compactMetadata, extractEntries } from "./normalize";
import { fetchUpstreamJson } from "./http";
import { CODEX_CATALOG_CLIENT_VERSION } from "../catalog/codexCatalog";
import type { UpstreamModelMetadata, UpstreamModelMetadataMap, UpstreamSourceAdapter, UpstreamSourceFetchContext } from "./types";

/** Codex 默认上游根地址；账号 `base_url` 覆盖时以账号为准。 */
const CODEX_DEFAULT_BASE_URL = "https://chatgpt.com/backend-api/codex";

/**
 * 从 `supported_reasoning_levels` 取出档位名。
 * 该字段既出现过 `["low","high"]`，也出现过 `[{effort:"low",...}]`。
 * @param value
 */
function reasoningLevelsOf(value: unknown): readonly string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const levels = value
		.map((item) => (typeof item === "string" ? item : asText(asRecord(item)?.["effort"])))
		.filter((item): item is string => item !== undefined);
	return levels.length > 0 ? levels : undefined;
}

/** Codex 适配器。 */
export const codexUpstreamAdapter: UpstreamSourceAdapter = {
	source: "codex",
	supported: true,

	hasCredential: function(account: SubscriptionAccount): boolean {
		const raw = asRecord(account.raw);
		return asText(raw?.["access_token"]) !== undefined && asText(raw?.["account_id"]) !== undefined;
	},

	list: async function(context: UpstreamSourceFetchContext): Promise<readonly unknown[] | null> {
		const raw = asRecord(context.account.raw);
		const token = asText(raw?.["access_token"]);
		const accountId = asText(raw?.["account_id"]);
		if (token === undefined || accountId === undefined) {
			return null;
		}
		const base = (asText(raw?.["base_url"]) ?? CODEX_DEFAULT_BASE_URL).replace(/\/+$/, "");
		const url = `${base}/models?client_version=${encodeURIComponent(CODEX_CATALOG_CLIENT_VERSION)}`;
		const result = await fetchUpstreamJson(
			url,
			{
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
					"Chatgpt-Account-Id": accountId,
					Originator: "codex-tui",
					"User-Agent": "codex-tui",
					Accept: "application/json",
				},
			},
			context.fetchImpl,
			context.timeoutMs,
		);
		if (!result.ok) {
			throw new Error(result.error);
		}
		return extractEntries(result.payload, ["models", "data"]);
	},

	parse: function(entries: readonly unknown[]): UpstreamModelMetadataMap {
		const map = new Map<string, UpstreamModelMetadata>();
		for (const entry of entries) {
			const record = asRecord(entry);
			const id = asText(record?.["slug"]) ?? asText(record?.["id"]);
			if (!record || id === undefined) {
				continue;
			}
			const inputModalities = asTextArray(record["input_modalities"]);
			const metadata = compactMetadata({
				displayName: asText(record["display_name"]) ?? asText(record["name"]),
				description: asText(record["description"]),
				// `max_context_window` 是模型理论上限，路由与校验用的是当前生效窗口。
				contextWindow: asNumber(record["context_window"]) ?? asNumber(record["max_context_window"]),
				supportsVision: inputModalities === undefined ? undefined : inputModalities.includes("image"),
				inputModalities: inputModalities,
				supportsReasoning: reasoningLevelsOf(record["supported_reasoning_levels"]) === undefined ? undefined : true,
				reasoningLevels: reasoningLevelsOf(record["supported_reasoning_levels"]),
				family: asText(record["family"]),
			});
			if (metadata !== undefined) {
				map.set(id, metadata);
			}
		}
		return map;
	},
};
