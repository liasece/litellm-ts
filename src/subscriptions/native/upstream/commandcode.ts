/**
 * CommandCode 的模型元信息。
 *
 * 上游 `GET /models` 只给很薄的一层：`context_length`、`display_name`、描述与
 * `supported_endpoints`，**没有**输出上限、价格或能力字段。解析器据此只填上下文，
 * 其余保持缺省——不要用静态目录的旧值冒充「上游说的」。
 */

import { COMMANDCODE_API_BASE } from "../catalog/dynamicCatalog";
import type { SubscriptionAccount } from "../types";
import { asNumber, asRecord, asText, compactMetadata, extractEntries } from "./normalize";
import { fetchUpstreamJson } from "./http";
import type { UpstreamModelMetadata, UpstreamModelMetadataMap, UpstreamSourceAdapter, UpstreamSourceFetchContext } from "./types";

/** 上游模型列表路径。 */
const MODELS_PATH = "/models";

/** CommandCode 适配器。 */
export const commandcodeUpstreamAdapter: UpstreamSourceAdapter = {
	source: "commandcode",
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
			`${COMMANDCODE_API_BASE}${MODELS_PATH}`,
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
			const record = asRecord(entry);
			const id = asText(record?.["id"]) ?? asText(record?.["name"]);
			if (!record || id === undefined) {
				continue;
			}
			const metadata = compactMetadata({
				displayName: asText(record["name"]) ?? asText(record["display_name"]),
				description: asText(record["description"]),
				contextWindow: asNumber(record["context_length"]) ?? asNumber(record["contextLength"]),
				maxOutputTokens: asNumber(record["max_completion_tokens"]) ?? asNumber(record["max_output_tokens"]),
			});
			if (metadata !== undefined) {
				map.set(id, metadata);
			}
		}
		return map;
	},
};
