import { z } from "zod";

const runtimeStatus = z
	.object({
		available: z.boolean(),
		enabled: z.boolean(),
		state: z.string(),
		version: z.string().nullable(),
		installed_versions: z.array(z.string()),
		pid: z.number().nullable(),
		started_at: z.string().nullable(),
		uptime_seconds: z.number().nullable(),
		restart_count: z.number(),
		last_exit_code: z.number().nullable(),
		last_error: z.string().nullable(),
		config_hash: z.string().nullable(),
		health: z.string(),
		operation: z.string().nullable(),
	})
	.passthrough();
const account = z
	.object({
		auth_index: z.string(),
		filename: z.string(),
		provider: z.string(),
		email: z.string().nullable(),
		disabled: z.boolean(),
		weight: z.number().nullable(),
		modified_at: z.string(),
	})
	.passthrough();
const managedAccount = z.object({ index: z.number(), label: z.string(), filename: z.string() }).passthrough();
const log = z
	.object({
		id: z.number(),
		timestamp: z.string(),
		stream: z.enum(["stdout", "stderr", "system", "oauth"]),
		message: z.string(),
	})
	.passthrough();
const release = z
	.object({ version: z.string(), published_at: z.string().nullable(), release_url: z.string(), notes: z.string() })
	.passthrough();
const update = z
	.object({ current: z.string().nullable(), latest: z.string(), update_available: z.boolean(), releases: z.array(release) })
	.passthrough();
const config = z
	.object({
		settings: z.object({ enabled: z.boolean(), config_yaml: z.string() }).passthrough(),
		user_config: z.record(z.string(), z.unknown()),
		status: runtimeStatus,
	})
	.passthrough();
const quota = z
	.object({
		provider: z.string(),
		plan: z.string().nullable(),
		subscription_expires_at: z.string().nullable(),
		windows: z.array(
			z
				.object({
					id: z.string(),
					label: z.string(),
					used_percent: z.number().nullable(),
					remaining_percent: z.number().nullable(),
					resets_at: z.string().nullable(),
				})
				.passthrough(),
		),
		balances: z.array(z.object({ label: z.string(), used: z.number(), limit: z.number(), unit: z.string() }).passthrough()),
		fetched_at: z.string(),
	})
	.passthrough();
const oauth = z
	.object({
		id: z.string(),
		provider: z.string(),
		state: z.string(),
		started_at: z.string(),
		finished_at: z.string().nullable(),
		exit_code: z.number().nullable(),
		output: z.array(z.string()),
	})
	.passthrough();

export function parseCliProxyResponse(path: string, method: string, payload: unknown): unknown {
	const pathname = path.split("?")[0];
	if (pathname === "/cliproxy/config" && ["GET", "PUT"].includes(method)) return config.parse(payload);
	if (method === "GET") {
		if (pathname === "/cliproxy/status") return runtimeStatus.parse(payload);
		if (pathname === "/cliproxy/accounts")
			return z
				.object({ data: z.array(account) })
				.passthrough()
				.parse(payload);
		if (pathname === "/cliproxy/commandcode/accounts")
			return z
				.object({ data: z.array(managedAccount) })
				.passthrough()
				.parse(payload);
		if (pathname === "/cliproxy/logs")
			return z
				.object({ entries: z.array(log), cursor: z.number() })
				.passthrough()
				.parse(payload);
		if (pathname === "/cliproxy/update/check") return update.parse(payload);
		if (/^\/cliproxy\/accounts\/[^/]+\/quota$/.test(pathname)) return quota.parse(payload);
	}
	if ((pathname === "/cliproxy/oauth" && method === "POST") || (/^\/cliproxy\/oauth\/[^/]+$/.test(pathname) && method === "GET"))
		return oauth.parse(payload);
	return payload;
}
