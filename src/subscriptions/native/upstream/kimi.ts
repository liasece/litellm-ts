/**
 * Kimi（Kimi Code OAuth 订阅）的模型元信息。
 *
 * 上游 kimi-cli 自己就是用 `GET {base}/v1/models` 列模型：Bearer OAuth token，
 * `{data:[…]}`，每条有 `id`、可选的 `context_length`、`supports_reasoning`、
 * `supports_image_in` / `supports_video_in`、`display_name`。
 *
 * 上游**没有**输出上限与价格字段；这两类继续由模型配置与内置目录提供，解析器保持缺省，
 * 不用静态目录的旧值冒充「上游说的」。
 */

import { resolveKimiBaseUrl } from "../providers/kimi";
import type { SubscriptionAccount } from "../types";
import { asBoolean, asNumber, asRecord, asText, compactMetadata, extractEntries } from "./normalize";
import { fetchUpstreamJson } from "./http";
import type { UpstreamModelMetadata, UpstreamModelMetadataMap, UpstreamSourceAdapter, UpstreamSourceFetchContext } from "./types";

/**
 * 计算模型列表地址：base 可能只到 `/coding`，也可能已经带 `/v1`，两种都兼容。
 * @param account - 账号
 */
function modelsUrl(account: SubscriptionAccount): string {
	const base = resolveKimiBaseUrl(account).replace(/\/+$/, "");
	return base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
}

/** Kimi 适配器。 */
export const kimiUpstreamAdapter: UpstreamSourceAdapter = {
	source: "kimi",
	supported: true,

	hasCredential: function(account: SubscriptionAccount): boolean {
		const raw = asRecord(account.raw);
		return asText(raw?.["access_token"]) !== undefined || asText(raw?.["api_key"]) !== undefined;
	},

	list: async function(context: UpstreamSourceFetchContext): Promise<readonly unknown[] | null> {
		const raw = asRecord(context.account.raw);
		const credential = asText(raw?.["access_token"]) ?? asText(raw?.["api_key"]);
		if (credential === undefined) {
			return null;
		}
		const result = await fetchUpstreamJson(
			modelsUrl(context.account),
			{ method: "GET", headers: { Authorization: `Bearer ${credential}`, Accept: "application/json" } },
			context.fetchImpl,
			context.timeoutMs,
		);
		if (!result.ok) {
			throw new Error(result.error);
		}
		return extractEntries(result.payload, ["data", "models"]);
	},

	parse: function(entries: readonly unknown[]): UpstreamModelMetadataMap {
		const map = new Map<string, UpstreamModelMetadata>();
		for (const entry of entries) {
			const record = asRecord(entry);
			const id = asText(record?.["id"]);
			if (record === undefined || id === undefined) {
				continue;
			}
			const modalities: string[] = [];
			if (asBoolean(record["supports_image_in"]) === true) {
				modalities.push("image");
			}
			if (asBoolean(record["supports_video_in"]) === true) {
				modalities.push("video");
			}
			const metadata = compactMetadata({
				displayName: asText(record["display_name"]),
				contextWindow: asNumber(record["context_length"]),
				supportsReasoning: asBoolean(record["supports_reasoning"]),
				supportsVision: asBoolean(record["supports_image_in"]),
				inputModalities: modalities.length > 0 ? [...modalities, "text"] : undefined,
			});
			if (metadata !== undefined) {
				map.set(id, metadata);
			}
		}
		return map;
	},
};
