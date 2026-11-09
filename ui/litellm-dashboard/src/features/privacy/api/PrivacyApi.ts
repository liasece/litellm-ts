/** `/privacy/*` 接口客户端与运行时校验。 */
import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import type {
	PrivacyApi,
	PrivacyListPage,
	PrivacyListQuery,
	PrivacyOverview,
	PrivacyRequestRow,
	PrivacySettings,
	PrivacyValueRow,
} from "../support/PrivacyModels";

const breakdown = z.object({ name: z.string(), occurrences: z.number(), requests: z.number().optional(), values: z.number().optional() });
const overviewSchema = z
	.object({
		days: z.number(),
		summary: z.object({ occurrences: z.number(), distinctValues: z.number(), requests: z.number(), unresolved: z.number() }),
		byClient: z.array(breakdown),
		byProvider: z.array(breakdown),
		byKind: z.array(breakdown),
		series: z.array(z.object({ bucket: z.string(), occurrences: z.number() })),
	})
	.passthrough();
const requestRow = z
	.object({
		requestId: z.string(),
		createdAt: z.string(),
		client: z.string(),
		provider: z.string(),
		model: z.string(),
		occurrences: z.number(),
		distinctValues: z.number(),
		kinds: z.record(z.string(), z.number()),
		action: z.string(),
		durationMs: z.number(),
		unresolved: z.number(),
	})
	.passthrough();
const valueRow = z
	.object({
		kind: z.string(),
		hash: z.string(),
		length: z.number(),
		hint: z.string(),
		occurrences: z.number(),
		requests: z.number(),
		clients: z.array(z.string()),
		lastSeen: z.string(),
	})
	.passthrough();
const pageSchema = <T extends z.ZodTypeAny>(row: T) =>
	z.object({ rows: z.array(row), has_more: z.boolean(), limit: z.number(), offset: z.number() }).passthrough();
const settingsValues = z
	.object({
		enabled: z.boolean(),
		action: z.string(),
		kinds: z.record(z.string(), z.string()),
		custom_words: z.array(z.unknown()),
		never_mask: z.array(z.string()),
		mask_configured_secrets: z.boolean(),
		fail_closed: z.boolean(),
		retention_days: z.number(),
	})
	.passthrough();

/**
 * 把接口的 snake_case 配置转换成页面模型。
 * @param value - 接口返回值
 */
function toSettings(value: z.infer<typeof settingsValues>): PrivacySettings {
	return {
		enabled: value.enabled,
		action: value.action,
		kinds: value.kinds as Record<string, string>,
		customWords: value.custom_words,
		neverMask: value.never_mask,
		maskConfiguredSecrets: value.mask_configured_secrets,
		failClosed: value.fail_closed,
		retentionDays: value.retention_days,
	};
}

/**
 * 组装列表查询串。
 * @param path - 接口路径
 * @param query - 查询
 */
function listPath(path: string, query: PrivacyListQuery): string {
	const search = new URLSearchParams({ days: String(query.days), limit: String(query.limit), offset: String(query.offset) });
	if (query.client) search.set("client", query.client);
	if (query.provider) search.set("provider", query.provider);
	if (query.kind) search.set("kind", query.kind);
	return path + "?" + search;
}

/** 默认实现 */
export const privacyApi: PrivacyApi = {
	overview(days, signal) {
		return requestJson(
			"/privacy/overview?days=" + String(days),
			{ signal: signal },
			(data) => overviewSchema.parse(data) as PrivacyOverview,
		);
	},
	requests(query, signal): Promise<PrivacyListPage<PrivacyRequestRow>> {
		return requestJson(listPath("/privacy/requests", query), { signal: signal }, (data) => {
			const parsed = pageSchema(requestRow).parse(data);
			return { rows: parsed.rows as PrivacyRequestRow[], hasMore: parsed.has_more };
		});
	},
	values(query, signal): Promise<PrivacyListPage<PrivacyValueRow>> {
		return requestJson(listPath("/privacy/values", query), { signal: signal }, (data) => {
			const parsed = pageSchema(valueRow).parse(data);
			return { rows: parsed.rows as PrivacyValueRow[], hasMore: parsed.has_more };
		});
	},
	async settings(signal) {
		return requestJson("/privacy/settings", { signal: signal }, (data) => {
			const parsed = z.object({ values: settingsValues }).passthrough().parse(data);
			return toSettings(parsed.values);
		});
	},
	async updateSettings(patch, signal) {
		return requestJson("/privacy/settings", { method: "PUT", body: JSON.stringify(patch), signal: signal }, (data) => {
			const parsed = z.object({ values: settingsValues }).passthrough().parse(data);
			return toSettings(parsed.values);
		});
	},
};
