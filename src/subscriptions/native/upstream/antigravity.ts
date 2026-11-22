/**
 * Antigravity（Google Cloud Code）的模型元信息。
 *
 * 上游是私有 `v1internal` 信封：`POST {base}/v1internal:fetchAvailableModels` 返回
 * `{models: {"<id>": {displayName, maxTokens, maxOutputTokens, supportsImages, ...}}}`。
 * 这跟 chat 请求同源于 `ANTIGRAVITY_CLOUDCODE_ENDPOINT`，账号的 `base_url` 与自定义头
 * 仍然优先，保持与 provider 一致。
 *
 * 字段单位是 token 数；`maxTokens` 是上下文窗口，`maxOutputTokens` 是输出上限。
 */

import { ANTIGRAVITY_CLOUDCODE_ENDPOINT, ANTIGRAVITY_API_VERSION, ANTIGRAVITY_USER_AGENT } from "../auth/antigravityConstants";
import type { SubscriptionAccount } from "../types";
import { asBoolean, asNumber, asRecord, asText, compactMetadata, extractEntries } from "./normalize";
import { fetchUpstreamJson } from "./http";
import type { UpstreamModelMetadata, UpstreamModelMetadataMap, UpstreamSourceAdapter, UpstreamSourceFetchContext } from "./types";

/**
 * 计算控制面地址：账号 `base_url` 优先。
 * @param account - 账号
 */
function baseUrl(account: SubscriptionAccount): string {
	const configured = asText(asRecord(account.raw)?.["base_url"]);
	return (configured ?? ANTIGRAVITY_CLOUDCODE_ENDPOINT).replace(/\/+$/, "");
}

/**
 * 由布尔开关与 MIME 表归纳输入模态。
 * @param record - 上游条目
 * @param hasMime - MIME 前缀判定
 */
function inputModalitiesOf(
	record: Record<string, unknown>,
	hasMime: (prefix: string) => boolean | undefined,
): readonly string[] | undefined {
	const modalities = ["text"];
	if (asBoolean(record["supportsImages"]) === true || hasMime("image/") === true) {
		modalities.push("image");
	}
	if (asBoolean(record["supportsVideo"]) === true || hasMime("video/") === true) {
		modalities.push("video");
	}
	if (asBoolean(record["supportsPdf"]) === true || hasMime("application/pdf") === true) {
		modalities.push("pdf");
	}
	return modalities.length > 1 ? modalities : undefined;
}

/** Antigravity 适配器。 */
export const antigravityUpstreamAdapter: UpstreamSourceAdapter = {
	source: "antigravity",
	supported: true,

	hasCredential: function (account: SubscriptionAccount): boolean {
		return asText(asRecord(account.raw)?.["access_token"]) !== undefined;
	},

	list: async function (context: UpstreamSourceFetchContext): Promise<readonly unknown[] | null> {
		const raw = asRecord(context.account.raw);
		const credential = asText(raw?.["access_token"]);
		if (credential === undefined) {
			return null;
		}
		const project = asText(raw?.["project_id"]) ?? asText(raw?.["cloudaicompanion_project"]);
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${credential}`,
			"User-Agent": asText(raw?.["user_agent"]) ?? ANTIGRAVITY_USER_AGENT,
			Accept: "application/json",
		};
		// 账号上配置的自定义头优先，与 provider 的请求头合并顺序一致。
		const configured = asRecord(raw?.["headers"]);
		if (configured !== undefined) {
			for (const [key, value] of Object.entries(configured)) {
				if (typeof value === "string" && value.trim().length > 0) {
					headers[key] = value;
				}
			}
		}
		const result = await fetchUpstreamJson(
			`${baseUrl(context.account)}/${ANTIGRAVITY_API_VERSION}:fetchAvailableModels`,
			{
				method: "POST",
				headers: headers,
				body: JSON.stringify(project === undefined ? {} : { project: project }),
			},
			context.fetchImpl,
			context.timeoutMs,
		);
		if (!result.ok) {
			throw new Error(result.error);
		}
		return extractEntries(result.payload, ["models", "data"]);
	},

	parse: function (entries: readonly unknown[]): UpstreamModelMetadataMap {
		const map = new Map<string, UpstreamModelMetadata>();
		for (const entry of entries) {
			const record = asRecord(entry);
			const id = asText(record?.["id"]) ?? asText(record?.["model"]);
			if (record === undefined || id === undefined) {
				continue;
			}
			// `supportedMimeTypes` 是 map<string,bool>；图片/PDF/视频支持也各有布尔字段。
			const mimeTypes = asRecord(record["supportedMimeTypes"]);
			// Prettier 会移除条件表达式外层括号，改块体以满足 no-confusing-arrow。
			const hasMime = (prefix: string): boolean | undefined => {
				if (mimeTypes === undefined) {
					return undefined;
				}
				return Object.entries(mimeTypes).some(([mime, supported]) => supported === true && mime.startsWith(prefix));
			};
			const metadata = compactMetadata({
				displayName: asText(record["displayName"]) ?? asText(record["display_name"]),
				description: asText(record["description"]),
				// maxTokens 是上下文窗口，maxOutputTokens 是输出上限（proto3 省略 0 值）。
				contextWindow: asNumber(record["maxTokens"]) ?? asNumber(record["inputTokenLimit"]),
				maxOutputTokens: asNumber(record["maxOutputTokens"]) ?? asNumber(record["outputTokenLimit"]),
				supportsVision: asBoolean(record["supportsImages"]) ?? hasMime("image/"),
				supportsReasoning: asBoolean(record["supportsThinking"]) ?? asBoolean(record["supportsRawThinking"]),
				supportsStructuredOutput: undefined,
				inputModalities: inputModalitiesOf(record, hasMime),
			});
			if (metadata !== undefined) {
				map.set(id, metadata);
			}
		}
		return map;
	},
};
