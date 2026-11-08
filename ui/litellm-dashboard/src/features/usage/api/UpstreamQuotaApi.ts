import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
const window = z.object({ id: z.string(), label: z.string(), remaining_percent: z.number().nullable(), resets_at: z.string().nullable() });
const balance = z.object({ label: z.string(), used: z.number(), limit: z.number(), unit: z.string() });
const account = z
	.object({ auth_index: z.string(), filename: z.string(), provider: z.string(), email: z.string().nullable() })
	.passthrough();
const quota = z
	.object({
		provider: z.string(),
		plan: z.string().nullable(),
		subscription_expires_at: z.string().nullable(),
		windows: z.array(window),
		balances: z.array(balance),
		fetched_at: z.string(),
	})
	.passthrough();
const builtIn = z
	.object({
		id: z.string(),
		provider: z.string(),
		label: z.string(),
		models: z.array(z.string()),
		account_kind: z.enum(["subscription", "pay_as_you_go", "unknown"]),
		plan: z.string().nullable(),
		subscription_expires_at: z.string().nullable(),
		windows: z.array(window),
		balances: z.array(
			z.object({ label: z.string(), remaining: z.number(), unit: z.string(), details: z.array(z.string()).optional() }),
		),
		warning: z.string().optional(),
		fetched_at: z.string(),
		error: z.string().optional(),
	})
	.passthrough();
export type UpstreamAccount = z.infer<typeof account>;
export type AccountQuota = z.infer<typeof quota>;
export type BuiltInQuotaAccount = z.infer<typeof builtIn>;
export type QuotaWindow = z.infer<typeof window>;
export const upstreamQuotaApi = {
	accounts: (signal?: AbortSignal) =>
		requestJson("/cliproxy/accounts", { signal }, (v) => z.object({ data: z.array(account) }).parse(v).data),
	quota: (id: string, signal?: AbortSignal) =>
		requestJson("/cliproxy/accounts/" + encodeURIComponent(id) + "/quota", { signal }, (v) => quota.parse(v)),
	builtIn: (force: boolean, signal?: AbortSignal) =>
		requestJson(
			"/provider/quota" + (force ? "?refresh=true" : ""),
			{ signal },
			(v) => z.object({ data: z.array(builtIn) }).parse(v).data,
		),
};
