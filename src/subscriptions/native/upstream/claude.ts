/**
 * Claude（Claude Code OAuth 订阅）的模型元信息。
 *
 * 两个来源互补，都会请求，缺一个不影响另一个：
 * 1. `GET {base}/v1/models?limit=1000` —— 该账号可见的模型列表；OAuth 需要
 *    Bearer + anthropic-version + oauth beta 与 claude-cli UA。文档声明条目可带
 *    `max_input_tokens`（上下文）与 `max_tokens`（输出上限），但两者都可能为 null。
 * 2. `GET https://downloads.claude.ai/model-catalog/v1/catalog.json` —— 公开签名目录，
 *    每条 `runtime.max_input_tokens` / `runtime.max_output_tokens` 是稳定数字，用来
 *    补 /v1/models 里缺失或被置空的限额。
 *
 * 价格不在这两个接口里（只在私有的 claude_cli/bootstrap），因此成本字段保持缺省。
 */

import type { SubscriptionAccount } from "../types";
import { asBoolean, asNumber, asRecord, asText, asTextArray, compactMetadata, extractEntries } from "./normalize";
import { fetchUpstreamJson } from "./http";
import type { UpstreamModelMetadata, UpstreamModelMetadataMap, UpstreamSourceAdapter, UpstreamSourceFetchContext } from "./types";

/** Claude Code 默认上游根地址。 */
const CLAUDE_DEFAULT_BASE_URL = "https://api.anthropic.com";
/** 公开模型目录（无需凭据）。 */
const CLAUDE_CATALOG_URL = "https://downloads.claude.ai/model-catalog/v1/catalog.json";
/** OAuth 订阅访问 /v1/models 需要的 beta 头。 */
const CLAUDE_OAUTH_BETAS = "oauth-2025-04-20,claude-code-20250219";
/** 上游会校验 UA 里的客户端版本，太旧会被拒。 */
const CLAUDE_CLI_USER_AGENT = "claude-cli/2.1.327 (external, sdk-cli)";

/**
 * 从公开目录里抽出所有 surface 的模型行。
 *
 * 结构是 `surfaces[surface].model_selector_state[].models[]` 与
 * `model_selector_config[].models[]`，不同 surface 内容基本重复，按 id 去重。
 * @param payload
 */
function catalogRows(payload: unknown): unknown[] {
	const surfaces = asRecord(asRecord(payload)?.["surfaces"]);
	if (surfaces === undefined) {
		return [];
	}
	const rows: unknown[] = [];
	for (const surface of Object.values(surfaces)) {
		const surfaceRecord = asRecord(surface);
		if (surfaceRecord === undefined) {
			continue;
		}
		for (const containerKey of ["model_selector_state", "model_selector_config"]) {
			const containers = surfaceRecord[containerKey];
			if (!Array.isArray(containers)) {
				continue;
			}
			for (const container of containers) {
				const models = asRecord(container)?.["models"];
				if (Array.isArray(models)) {
					rows.push(...models);
				}
			}
		}
	}
	return rows;
}

/**
 * 从能力对象里读 `{supported: boolean}` 形式的开关。
 * @param capabilities
 * @param key
 */
function capabilityFlag(capabilities: unknown, key: string): boolean | undefined {
	const value = asRecord(asRecord(capabilities)?.[key]);
	return typeof value?.["supported"] === "boolean" ? (value["supported"] as boolean) : undefined;
}

/** Claude 适配器。 */
export const claudeUpstreamAdapter: UpstreamSourceAdapter = {
	source: "claude",
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
		const base = (asText(raw?.["base_url"]) ?? CLAUDE_DEFAULT_BASE_URL).replace(/\/+$/, "");
		const modelsPromise = fetchUpstreamJson(
			`${base}/v1/models?limit=1000`,
			{
				method: "GET",
				headers: {
					Authorization: `Bearer ${credential}`,
					"anthropic-version": "2023-06-01",
					"anthropic-beta": CLAUDE_OAUTH_BETAS,
					"User-Agent": CLAUDE_CLI_USER_AGENT,
					"x-app": "cli",
					Accept: "application/json",
				},
			},
			context.fetchImpl,
			context.timeoutMs,
		);
		// 公开目录只是补充限额；失败时仍然返回账号可见的模型列表。
		const catalogPromise = fetchUpstreamJson(
			CLAUDE_CATALOG_URL,
			{ method: "GET", headers: { Accept: "application/json" } },
			context.fetchImpl,
			context.timeoutMs,
		).catch(() => ({ ok: false as const, error: "目录请求失败" }));
		const models = await modelsPromise;
		if (!models.ok) {
			throw new Error(models.error);
		}
		const catalog = await catalogPromise;
		const rows = catalog.ok ? catalogRows(catalog.payload) : [];
		return [...rows, ...extractEntries(models.payload, ["data"])];
	},

	parse: function(entries: readonly unknown[]): UpstreamModelMetadataMap {
		const merged = new Map<string, UpstreamModelMetadata>();
		const merge = (id: string, patch: UpstreamModelMetadata): void => {
			const existing = merged.get(id);
			if (existing === undefined) {
				merged.set(id, patch);
				return;
			}
			const next: Record<string, unknown> = { ...existing };
			for (const [key, value] of Object.entries(patch)) {
				if (value !== undefined) {
					next[key] = value;
				}
			}
			merged.set(id, next as UpstreamModelMetadata);
		};
		for (const entry of entries) {
			const record = asRecord(entry);
			if (record === undefined) {
				continue;
			}
			// 公开目录条目：限额在 runtime 里，优先级高于 null 的 /v1/models 字段。
			const runtime = asRecord(record["runtime"]);
			if (runtime !== undefined) {
				const id = asText(record["id"]);
				if (id === undefined) {
					continue;
				}
				const metadata = compactMetadata({
					displayName: asText(record["name"]) ?? asText(record["short_name"]),
					description: asText(record["description"]),
					contextWindow: asNumber(runtime["max_input_tokens"]),
					maxOutputTokens: asNumber(runtime["max_output_tokens"]),
					family: asText(runtime["family"]),
					supportsTools: asTextArray(runtime["capabilities"])?.some((item) => item.includes("tool")) ?? undefined,
					supportsVision: asTextArray(runtime["capabilities"])?.some((item) => item.includes("image")) ?? undefined,
				});
				if (metadata !== undefined) {
					merge(id, metadata);
				}
				continue;
			}
			// /v1/models 条目。
			const id = asText(record["id"]);
			if (id === undefined) {
				continue;
			}
			const capabilities = record["capabilities"];
			const metadata = compactMetadata({
				displayName: asText(record["display_name"]),
				contextWindow: asNumber(record["max_input_tokens"]),
				maxOutputTokens: asNumber(record["max_tokens"]),
				family: asText(record["line"]),
				supportsVision: capabilityFlag(capabilities, "image_input"),
				supportsStructuredOutput: capabilityFlag(capabilities, "structured_outputs"),
				supportsReasoning: capabilityFlag(capabilities, "thinking") ?? (asBoolean(asRecord(asRecord(capabilities)?.["thinking"])?.["supported"])),
			});
			if (metadata !== undefined) {
				merge(id, metadata);
			}
		}
		return merged;
	},
};
