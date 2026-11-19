import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
/* 缓存与接口共用同一份 schema：本地快照解析失败就整条丢弃，不会把半截数据画到页面上。 */
export const quotaWindowSchema = z.object({
	id: z.string(),
	label: z.string(),
	remaining_percent: z.number().nullable(),
	resets_at: z.string().nullable(),
});
const balance = z.object({ label: z.string(), used: z.number(), limit: z.number(), unit: z.string() });
export const upstreamAccountSchema = z
	.object({ auth_index: z.string(), key: z.string(), provider: z.string(), email: z.string().nullable() })
	.passthrough();
export const accountQuotaSchema = z
	.object({
		provider: z.string(),
		plan: z.string().nullable(),
		subscription_expires_at: z.string().nullable(),
		windows: z.array(quotaWindowSchema),
		balances: z.array(balance),
		email: z.string().nullable().optional(),
		fetched_at: z.string(),
	})
	.passthrough();
export const builtInQuotaAccountSchema = z
	.object({
		id: z.string(),
		provider: z.string(),
		label: z.string(),
		models: z.array(z.string()),
		account_kind: z.enum(["subscription", "pay_as_you_go", "unknown"]),
		plan: z.string().nullable(),
		subscription_expires_at: z.string().nullable(),
		windows: z.array(quotaWindowSchema),
		balances: z.array(
			z.object({ label: z.string(), remaining: z.number(), unit: z.string(), details: z.array(z.string()).optional() }),
		),
		warning: z.string().optional(),
		fetched_at: z.string(),
		error: z.string().optional(),
	})
	.passthrough();
export type UpstreamAccount = z.infer<typeof upstreamAccountSchema>;
export type AccountQuota = z.infer<typeof accountQuotaSchema>;
export type BuiltInQuotaAccount = z.infer<typeof builtInQuotaAccountSchema>;
export type QuotaWindow = z.infer<typeof quotaWindowSchema>;
export const upstreamQuotaApi = {
	accounts: (signal?: AbortSignal) =>
		requestJson("/subscriptions/accounts", { signal }, (v) => z.object({ data: z.array(upstreamAccountSchema) }).parse(v).data),
	quota: (id: string, signal?: AbortSignal) =>
		requestJson("/subscriptions/accounts/" + encodeURIComponent(id) + "/quota", { signal }, (v) => accountQuotaSchema.parse(v)),
	builtIn: (force: boolean, signal?: AbortSignal) =>
		requestJson(
			"/provider/quota" + (force ? "?refresh=true" : ""),
			{ signal },
			(v) => z.object({ data: z.array(builtInQuotaAccountSchema) }).parse(v).data,
		),
};
