/**
 * xAI（Grok 订阅）的模型元信息。
 *
 * 官方 `GET {base}/models` 是 OpenAI 形状的 `{data:[{id, object, created, owned_by}]}`；
 * Grok CLI 的 OAuth 账号默认走 `cli-chat-proxy.grok.com`，需要附加 CLI 身份头，
 * 因此这里按账号的 `base_url`/`auth_kind` 选择与 provider 相同的地址与头。
 *
 * 上游是否带上下文/价格字段并不稳定，解析器按常见别名尽力读取；读不到就保持缺省。
 */

import type { SubscriptionAccount } from "../types";
import { asNumber, asRecord, asText, asTextArray, compactMetadata, extractEntries } from "./normalize";
import { fetchUpstreamJson } from "./http";
import type { UpstreamModelMetadata, UpstreamModelMetadataMap, UpstreamSourceAdapter, UpstreamSourceFetchContext } from "./types";

/** 官方 xAI API 基础地址。 */
const DEFAULT_API_BASE_URL = "https://api.x.ai/v1";
/** Grok CLI chat-proxy 基础地址（OAuth 账号默认）。 */
const CLI_CHAT_PROXY_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
/** 取不到账号版本时的 Grok CLI 版本。 */
const FALLBACK_CLIENT_VERSION = "1.0.46";

/**
 * 计算模型列表地址。
 *
 * OAuth 账号在未显式配置 base_url 时用 CLI chat-proxy，其余用官方 API——与 provider
 * 的 `chatBaseUrl` 判定一致。订阅 token 直接打官方 API 会 403
 * `personal-team-blocked:spending-limit`，所以这条判定不能省。
 * @param account - 账号
 */
function modelsBaseUrl(account: SubscriptionAccount): string {
	const raw = asRecord(account.raw);
	const configured = asText(raw?.["base_url"])?.replace(/\/+$/, "");
	const authKind = asText(raw?.["auth_kind"])?.toLowerCase();
	const isOauth = authKind === "oauth" || (authKind === undefined && asText(raw?.["refresh_token"]) !== undefined);
	if (configured !== undefined) {
		return configured;
	}
	return isOauth ? CLI_CHAT_PROXY_BASE_URL : DEFAULT_API_BASE_URL;
}

/**
 * 价格换算：上游单位是「USD 分 / 100M token」。
 * @param centsPer100M - 上游价格
 */
function centsPer100MToPerToken(centsPer100M: number | undefined): number | undefined {
	return centsPer100M === undefined ? undefined : centsPer100M / 1e10;
}

/**
 * `reasoning_efforts` 既可能是字符串数组，也可能是 `[{id|value|label}]`。
 * @param value - 上游字段
 */
function reasoningEffortsOf(value: unknown): readonly string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const levels = value
		.map((item) => (typeof item === "string" ? item : asText(asRecord(item)?.["value"]) ?? asText(asRecord(item)?.["id"])))
		.filter((item): item is string => item !== undefined);
	return levels.length > 0 ? levels : undefined;
}

/** xAI 适配器。 */
export const xaiUpstreamAdapter: UpstreamSourceAdapter = {
	source: "xai",
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
		const base = modelsBaseUrl(context.account);
		const version = asText(raw?.["client_version"]) ?? FALLBACK_CLIENT_VERSION;
		const headers: Record<string, string> = {
			Authorization: `Bearer ${credential}`,
			Accept: "application/json",
			"User-Agent": `xai-grok-workspace/${version}`,
		};
		if (base === CLI_CHAT_PROXY_BASE_URL) {
			headers["X-XAI-Token-Auth"] = "xai-grok-cli";
			headers["x-grok-client-version"] = version;
			headers["x-grok-client-identifier"] = "grok-shell";
		}
		const configured = asRecord(raw?.["headers"]);
		if (configured !== undefined) {
			for (const [key, value] of Object.entries(configured)) {
				if (typeof value === "string" && value.trim().length > 0) {
					headers[key] = value;
				}
			}
		}
		const result = await fetchUpstreamJson(
			`${base}/models`,
			{ method: "GET", headers: headers },
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
			const id = asText(record?.["id"]) ?? asText(record?.["model"]);
			if (record === undefined || id === undefined) {
				continue;
			}
			// 两条 rail 的字段不同：官方 API 是 context_length + capabilities.reasoning_effort
			// + 价格（USD 分/1 亿 token）；CLI proxy 是 context_window + reasoning_efforts[]。
			const capabilities = asRecord(record["capabilities"]);
			const reasoningEfforts = asTextArray(record["reasoning_efforts"]) ?? asTextArray(capabilities?.["reasoning_effort"]) ?? reasoningEffortsOf(record["reasoning_efforts"]);
			const inputModalities = asTextArray(record["input_modalities"]);
			const metadata = compactMetadata({
				displayName: asText(record["display_name"]) ?? asText(record["name"]),
				description: asText(record["description"]),
				contextWindow:
					asNumber(record["context_window"]) ?? asNumber(record["context_length"]) ?? asNumber(record["max_context_window"]),
				maxOutputTokens: asNumber(record["max_output_tokens"]) ?? asNumber(record["max_completion_tokens"]),
				inputModalities: inputModalities,
				supportsVision: inputModalities?.includes("image"),
				supportsReasoning: reasoningEfforts === undefined ? undefined : true,
				reasoningLevels: reasoningEfforts,
				// 官方 API 的价格单位是「USD 分 / 100M token」，换成 per-token 要除以 1e10。
				inputCostPerToken: centsPer100MToPerToken(asNumber(record["prompt_text_token_price"])),
				outputCostPerToken: centsPer100MToPerToken(asNumber(record["completion_text_token_price"])),
				cacheReadCostPerToken: centsPer100MToPerToken(asNumber(record["cached_prompt_text_token_price"])),
			});
			if (metadata !== undefined) {
				map.set(id, metadata);
			}
		}
		return map;
	},
};
