/* eslint-disable jsdoc/require-throws */
import { ApiError } from "../core/api/ApiError";
import type { CliProxyAccountQuota, CliProxyQuotaBalance, CliProxyQuotaWindow } from "./CliProxyTypes";

/**
 *
 */
export interface CliProxyQuotaRequest {
	/**
	 *
	 */
	readonly id: string;
	/**
	 *
	 */
	readonly method: "GET" | "POST";
	/**
	 *
	 */
	readonly url: string;
	/**
	 *
	 */
	readonly header: Record<string, string>;
	/**
	 *
	 */
	readonly data?: string;
	/** Stop trying later requests in this group after the first successful response. */
	readonly fallback_group?: string;
}

interface QuotaPayload {
	readonly id: string;
	readonly body: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function array(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function numberValue(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value !== "string" || value.trim() === "") {
		return null;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function boundedPercent(value: number | null): number | null {
	return value === null ? null : Math.max(0, Math.min(100, value));
}

function resetAt(window: Record<string, unknown>, nowMs: number): string | null {
	const direct = window["reset_at"] ?? window["resetAt"] ?? window["resets_at"] ?? window["resetTime"];
	const numeric = numberValue(direct);
	if (numeric !== null) {
		const milliseconds = numeric < 1e12 ? numeric * 1_000 : numeric;
		const date = new Date(milliseconds);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	}
	const text = stringValue(direct);
	if (text) {
		const date = new Date(text);
		return Number.isNaN(date.getTime()) ? text : date.toISOString();
	}
	const after = numberValue(window["reset_after_seconds"] ?? window["resetAfterSeconds"] ?? window["resetIn"]);
	return after === null ? null : new Date(nowMs + Math.max(0, after) * 1_000).toISOString();
}

function percentWindow(
	id: string,
	label: string,
	usedValue: unknown,
	resetSource: Record<string, unknown>,
	nowMs: number,
): CliProxyQuotaWindow {
	const used = boundedPercent(numberValue(usedValue));
	return {
		id: id,
		label: label,
		used_percent: used,
		remaining_percent: used === null ? null : boundedPercent(100 - used),
		resets_at: resetAt(resetSource, nowMs),
	};
}

function windowDurationLabel(window: Record<string, unknown>, fallback: string): string {
	const seconds = numberValue(window["limit_window_seconds"] ?? window["limitWindowSeconds"]);
	if (seconds === null) {
		return fallback;
	}
	if (Math.abs(seconds - 18_000) < 60) {
		return "5 小时";
	}
	if (Math.abs(seconds - 604_800) < 60) {
		return "7 天";
	}
	if (seconds >= 28 * 86_400 && seconds <= 31 * 86_400) {
		return "月度";
	}
	if (seconds % 86_400 === 0) {
		return `${seconds / 86_400} 天`;
	}
	if (seconds % 3_600 === 0) {
		return `${seconds / 3_600} 小时`;
	}
	return fallback;
}

function codexWindows(payload: Record<string, unknown>, nowMs: number): CliProxyQuotaWindow[] {
	const windows: CliProxyQuotaWindow[] = [];
	const addRateLimit = (prefix: string, label: string, value: unknown): void => {
		const rate = record(value);
		if (!rate) {
			return;
		}
		for (const [key, fallback] of [
			["primary_window", "主要窗口"],
			["secondary_window", "次要窗口"],
		] as const) {
			const window = record(rate[key] ?? rate[key === "primary_window" ? "primaryWindow" : "secondaryWindow"]);
			if (!window) {
				continue;
			}
			const duration = windowDurationLabel(window, fallback);
			windows.push(
				percentWindow(
					`${prefix}-${key.replace("_window", "").replace("_", "-")}`,
					`${label}${duration}`,
					window["used_percent"] ?? window["usedPercent"],
					window,
					nowMs,
				),
			);
		}
	};

	addRateLimit("codex", "Codex · ", payload["rate_limit"] ?? payload["rateLimit"]);
	addRateLimit("code-review", "代码审查 · ", payload["code_review_rate_limit"] ?? payload["codeReviewRateLimit"]);
	array(payload["additional_rate_limits"] ?? payload["additionalRateLimits"]).forEach((value, index) => {
		const additional = record(value);
		if (!additional) {
			return;
		}
		const name =
			stringValue(additional["limit_name"] ?? additional["limitName"] ?? additional["metered_feature"]) ?? `附加限额 ${index + 1}`;
		addRateLimit(`additional-${index}`, `${name} · `, additional["rate_limit"] ?? additional["rateLimit"]);
	});
	return windows;
}

function codexAuthMetadata(authFile: Record<string, unknown>): Record<string, unknown> {
	// 新版 /auth-files 将 Codex 账户信息放在已解析的 id_token 对象中。
	return { ...record(authFile["id_token"]), ...authFile };
}

function normalizeCodex(
	payload: Record<string, unknown>,
	authFile: Record<string, unknown>,
	nowMs: number,
): Omit<CliProxyAccountQuota, "provider" | "fetched_at"> {
	const metadata = codexAuthMetadata(authFile);
	const credits = record(payload["rate_limit_reset_credits"] ?? payload["rateLimitResetCredits"]);
	const availableCredits = numberValue(credits?.["available_count"] ?? credits?.["availableCount"]);
	const balances: CliProxyQuotaBalance[] =
		availableCredits === null ? [] : [{ label: "限额重置次数", used: 0, limit: availableCredits, unit: "次可用" }];
	return {
		plan: stringValue(payload["plan_type"] ?? payload["planType"] ?? metadata["plan_type"] ?? metadata["planType"]),
		subscription_expires_at: normalizeDate(metadata["chatgpt_subscription_active_until"] ?? metadata["subscription_active_until"]),
		windows: codexWindows(payload, nowMs),
		balances: balances,
	};
}

const CLAUDE_WINDOW_LABELS: ReadonlyArray<readonly [string, string]> = [
	["five_hour", "5 小时"],
	["seven_day", "7 天"],
	["seven_day_oauth_apps", "7 天 OAuth 应用"],
	["seven_day_opus", "7 天 Opus"],
	["seven_day_sonnet", "7 天 Sonnet"],
	["seven_day_cowork", "7 天 Cowork"],
	["iguana_necktie", "7 天 Fable"],
];

function normalizeClaude(
	usage: Record<string, unknown>,
	profile: Record<string, unknown> | null,
	nowMs: number,
): Omit<CliProxyAccountQuota, "provider" | "fetched_at"> {
	const windows = CLAUDE_WINDOW_LABELS.flatMap(([key, label]) => {
		const value = record(usage[key]);
		return value ? [percentWindow(key.replaceAll("_", "-"), label, value["utilization"], value, nowMs)] : [];
	});
	const limits = array(usage["limits"]);
	limits.forEach((value, index) => {
		const limit = record(value);
		const percent = numberValue(limit?.["percent"]);
		if (!limit || percent === null || limit["is_active"] === false) {
			return;
		}
		const scope = record(limit["scope"]);
		const model = record(scope?.["model"]);
		const label = stringValue(model?.["display_name"] ?? model?.["id"]) ?? stringValue(limit["kind"]) ?? `模型限额 ${index + 1}`;
		windows.push(percentWindow(`limit-${index}`, label, percent, limit, nowMs));
	});
	const extra = record(usage["extra_usage"]);
	const balances: CliProxyQuotaBalance[] = [];
	if (extra?.["is_enabled"] === true) {
		const used = numberValue(extra["used_credits"]);
		const limit = numberValue(extra["monthly_limit"]);
		if (used !== null && limit !== null) {
			balances.push({ label: "额外用量", used: used / 100, limit: limit / 100, unit: "USD" });
		}
	}
	const account = record(profile?.["account"]);
	const organization = record(profile?.["organization"]);
	let plan: string | null = null;
	if (account?.["has_claude_max"] === true) {
		plan = "Max";
	} else if (account?.["has_claude_pro"] === true) {
		plan = "Pro";
	} else if (
		stringValue(organization?.["organization_type"])?.toLowerCase() === "claude_team" &&
		stringValue(organization?.["subscription_status"])?.toLowerCase() === "active"
	) {
		plan = "Team";
	} else if (account?.["has_claude_max"] === false && account?.["has_claude_pro"] === false) {
		plan = "Free";
	}
	return { plan: plan, subscription_expires_at: null, windows: windows, balances: balances };
}

function kimiRow(value: unknown, id: string, fallbackLabel: string, nowMs: number): CliProxyQuotaWindow | null {
	const outer = record(value);
	if (!outer) {
		return null;
	}
	const detail = record(outer["detail"]) ?? outer;
	const used = numberValue(detail["used"]);
	const limit = numberValue(detail["limit"]);
	const explicitRemaining = numberValue(detail["remaining"]);
	const usedPercent =
		used !== null && limit !== null && limit > 0
			? boundedPercent((used / limit) * 100)
			: explicitRemaining !== null && limit !== null && limit > 0
				? boundedPercent(((limit - explicitRemaining) / limit) * 100)
				: null;
	if (used === null && limit === null && explicitRemaining === null) {
		return null;
	}
	return {
		id: id,
		label: stringValue(detail["name"] ?? detail["title"] ?? outer["name"] ?? outer["title"]) ?? fallbackLabel,
		used_percent: usedPercent,
		remaining_percent: usedPercent === null ? null : boundedPercent(100 - usedPercent),
		resets_at: resetAt({ ...outer, ...detail }, nowMs),
	};
}

function normalizeKimi(payload: Record<string, unknown>, nowMs: number): Omit<CliProxyAccountQuota, "provider" | "fetched_at"> {
	const windows = array(payload["limits"]).flatMap((value, index) => {
		const window = kimiRow(value, `limit-${index}`, `限额 ${index + 1}`, nowMs);
		return window ? [window] : [];
	});
	const summary = kimiRow(payload["usage"], "summary", "周限额", nowMs);
	if (summary) {
		windows.push(summary);
	}
	return { plan: null, subscription_expires_at: null, windows: windows, balances: [] };
}

function normalizeAntigravity(
	payload: Record<string, unknown>,
	authFile: Record<string, unknown>,
	nowMs: number,
): Omit<CliProxyAccountQuota, "provider" | "fetched_at"> {
	const windows: CliProxyQuotaWindow[] = [];
	array(payload["groups"]).forEach((groupValue, groupIndex) => {
		const group = record(groupValue);
		if (!group) {
			return;
		}
		const groupLabel = stringValue(group["displayName"] ?? group["display_name"]) ?? `配额组 ${groupIndex + 1}`;
		array(group["buckets"]).forEach((bucketValue, bucketIndex) => {
			const bucket = record(bucketValue);
			if (!bucket) {
				return;
			}
			const fraction = numberValue(bucket["remainingFraction"] ?? bucket["remaining_fraction"]);
			const remaining = fraction === null ? null : boundedPercent(fraction * 100);
			windows.push({
				id: stringValue(bucket["bucketId"] ?? bucket["bucket_id"]) ?? `group-${groupIndex}-${bucketIndex}`,
				label: stringValue(bucket["displayName"] ?? bucket["display_name"]) ?? groupLabel,
				used_percent: remaining === null ? null : boundedPercent(100 - remaining),
				remaining_percent: remaining,
				resets_at: resetAt(bucket, nowMs),
			});
		});
	});
	return {
		plan: stringValue(authFile["subscription_tier"] ?? authFile["plan_type"]),
		subscription_expires_at: null,
		windows: windows,
		balances: [],
	};
}

function normalizeXai(payloads: Record<string, unknown>[], nowMs: number): Omit<CliProxyAccountQuota, "provider" | "fetched_at"> {
	const windows: CliProxyQuotaWindow[] = [];
	const balances: CliProxyQuotaBalance[] = [];
	payloads.forEach((payload, payloadIndex) => {
		const config = record(payload["config"]) ?? payload;
		const period = record(config["currentPeriod"] ?? config["current_period"]);
		const used = numberValue(config["creditUsagePercent"] ?? config["credit_usage_percent"]);
		if (used !== null) {
			const label = stringValue(period?.["type"]) ?? (payloadIndex === 0 ? "周限额" : "月限额");
			windows.push(percentWindow(`billing-${payloadIndex}`, label, used, { reset_at: period?.["end"] }, nowMs));
		}
		array(config["productUsage"] ?? config["product_usage"]).forEach((value, productIndex) => {
			const product = record(value);
			const productUsed = numberValue(product?.["usagePercent"] ?? product?.["usage_percent"]);
			if (!product || productUsed === null) {
				return;
			}
			windows.push(
				percentWindow(
					`billing-${payloadIndex}-product-${productIndex}`,
					stringValue(product["product"]) ?? `产品 ${productIndex + 1}`,
					productUsed,
					{ reset_at: period?.["end"] },
					nowMs,
				),
			);
		});
		const monthlyLimit = nestedNumber(config["monthlyLimit"] ?? config["monthly_limit"]);
		const usedCredits = nestedNumber(config["used"]);
		if (monthlyLimit !== null && usedCredits !== null && payloadIndex === payloads.length - 1) {
			balances.push({ label: "包含额度", used: usedCredits / 100, limit: monthlyLimit / 100, unit: "USD" });
		}
	});
	return { plan: null, subscription_expires_at: null, windows: windows, balances: balances };
}

function nestedNumber(value: unknown): number | null {
	const nested = record(value);
	return numberValue(nested?.["val"] ?? value);
}

function normalizeDate(value: unknown): string | null {
	const numeric = numberValue(value);
	const source = numeric !== null ? (numeric < 1e12 ? numeric * 1_000 : numeric) : stringValue(value);
	if (source === null) {
		return null;
	}
	const date = new Date(source);
	return Number.isNaN(date.getTime()) ? String(source) : date.toISOString();
}

function firstPayload(payloads: QuotaPayload[], id: string): Record<string, unknown> | null {
	return record(payloads.find((payload) => payload.id === id)?.body);
}

const PLUGIN_WINDOW_LABELS: Record<string, string> = {
	rolling: "5 小时",
	weekly: "周",
	monthly: "月",
};

/**
 * 归一化 CLIProxy 插件 QuotaProvider 的通用额度结构。
 * @param providerValue
 * @param payload
 */
export function normalizeCliProxyPluginQuota(
	providerValue: string,
	payload: unknown,
): Omit<CliProxyAccountQuota, "provider" | "fetched_at"> | null {
	const provider = providerValue.trim().toLowerCase();
	const value = record(payload);
	if (!value) {
		return null;
	}
	const subscription = record(value["subscription"]);
	const windows: CliProxyQuotaWindow[] = [];
	for (const groupValue of array(value["groups"])) {
		const group = record(groupValue);
		if (!group) {
			continue;
		}
		const groupLabel = stringValue(group["displayName"] ?? group["display_name"]);
		for (const bucketValue of array(group["buckets"])) {
			const bucket = record(bucketValue);
			if (!bucket) {
				continue;
			}
			const remaining = numberValue(bucket["remainingFraction"] ?? bucket["remaining_fraction"]);
			if (remaining === null) {
				continue;
			}
			const remainingPercent = boundedPercent(remaining * 100);
			if (remainingPercent === null) {
				continue;
			}
			const windowName = stringValue(bucket["window"]) ?? `bucket-${windows.length + 1}`;
			windows.push({
				id: `${provider}:${windowName}`,
				label: PLUGIN_WINDOW_LABELS[windowName.toLowerCase()] ?? groupLabel ?? windowName,
				used_percent: Math.round((100 - remainingPercent) * 100) / 100,
				remaining_percent: Math.round(remainingPercent * 100) / 100,
				resets_at: normalizeDate(bucket["resetTime"] ?? bucket["reset_time"]),
			});
		}
	}
	if (windows.length === 0) {
		return null;
	}
	return {
		plan: stringValue(subscription?.["plan"]) ?? stringValue(subscription?.["tierName"]) ?? null,
		subscription_expires_at: null,
		windows: windows,
		balances: [],
	};
}

const COMMANDCODE_WINDOW_LABELS: Record<string, string> = {
	five_hour: "5 小时",
	weekly: "周",
	month: "月",
};

/**
 * 归一化 CommandCode 插件 quota-usage 接口返回的账号额度。
 * @param payload
 * @param authIndex
 */
export function normalizeCliProxyCommandCodeQuota(
	payload: unknown,
	authIndex: string,
): Omit<CliProxyAccountQuota, "provider" | "fetched_at"> | null {
	const value = record(payload);
	if (!value) {
		return null;
	}
	let card: Record<string, unknown> | null = null;
	if (Array.isArray(value["cards"])) {
		for (const candidate of value["cards"]) {
			const entry = record(candidate);
			if (!entry) {
				continue;
			}
			if (stringValue(entry["key_id"]) === authIndex) {
				card = entry;
				break;
			}
			if (!card) {
				card = entry;
			}
		}
	} else if (value["key_id"] !== undefined || value["usage"] !== undefined || value["error"] !== undefined) {
		// 指定 key_id 时插件直接返回单个账户卡片，而不是 { cards: [...] }。
		card = value;
	}
	if (!card) {
		return null;
	}
	const failure = stringValue(card["error"]);
	if (failure) {
		throw ApiError.unavailable(`CommandCode 额度查询失败: ${failure}`);
	}
	const usage = record(card["usage"]);
	if (!usage) {
		return null;
	}
	const windows: CliProxyQuotaWindow[] = [];
	for (const key of ["five_hour", "weekly", "month"]) {
		const window = record(usage[key]);
		if (!window) {
			continue;
		}
		const rawPercent = numberValue(window["percent"]);
		const cap = numberValue(window["cap"]);
		const used = numberValue(window["used"]);
		const computed = rawPercent ?? (cap !== null && cap > 0 && used !== null ? (used / cap) * 100 : null);
		const percent = boundedPercent(computed);
		if (percent === null) {
			continue;
		}
		windows.push({
			id: `commandcode:${key}`,
			label: COMMANDCODE_WINDOW_LABELS[key] ?? key,
			used_percent: percent,
			remaining_percent: Math.round((100 - percent) * 100) / 100,
			resets_at: normalizeDate(window["resets_at"]),
		});
	}
	const planCredits = numberValue(usage["plan_credits"]) ?? 0;
	const creditsLeft = numberValue(usage["credits_left"]) ?? 0;
	const balances: CliProxyQuotaBalance[] = [];
	if (planCredits > 0) {
		balances.push({
			label: "剩余计划额度",
			used: Math.min(planCredits, Math.max(0, planCredits - creditsLeft)),
			limit: planCredits,
			unit: "$",
		});
	} else if (creditsLeft > 0) {
		balances.push({ label: "剩余额度", used: 0, limit: creditsLeft, unit: "$" });
	}
	const month = record(usage["month"]);
	return {
		plan: stringValue(usage["plan"]) ?? null,
		subscription_expires_at: normalizeDate(month?.["resets_at"]),
		windows: windows,
		balances: balances,
	};
}

/**
 * @param providerValue
 * @param payloads
 * @param authFile
 * @param nowMs
 */
export function normalizeCliProxyQuota(
	providerValue: string,
	payloads: QuotaPayload[],
	authFile: Record<string, unknown>,
	nowMs = Date.now(),
): CliProxyAccountQuota {
	const provider = providerValue.trim().toLowerCase();
	let normalized: Omit<CliProxyAccountQuota, "provider" | "fetched_at">;
	if (provider === "codex") {
		const payload = firstPayload(payloads, "usage");
		if (!payload) {
			throw ApiError.unavailable("Codex 额度响应无效");
		}
		normalized = normalizeCodex(payload, authFile, nowMs);
	} else if (provider === "claude" || provider === "anthropic") {
		const usage = firstPayload(payloads, "usage");
		if (!usage) {
			throw ApiError.unavailable("Claude 额度响应无效");
		}
		normalized = normalizeClaude(usage, firstPayload(payloads, "profile"), nowMs);
	} else if (provider === "kimi") {
		const payload = firstPayload(payloads, "usage");
		if (!payload) {
			throw ApiError.unavailable("Kimi 额度响应无效");
		}
		normalized = normalizeKimi(payload, nowMs);
	} else if (provider === "antigravity") {
		const payload = payloads.map((item) => record(item.body)).find((item) => item && Array.isArray(item["groups"]));
		if (!payload) {
			throw ApiError.unavailable("Antigravity 额度响应无效");
		}
		normalized = normalizeAntigravity(payload, authFile, nowMs);
	} else if (provider === "xai") {
		const values = payloads.map((item) => record(item.body)).filter((item): item is Record<string, unknown> => item !== null);
		if (values.length === 0) {
			throw ApiError.unavailable("xAI 额度响应无效");
		}
		normalized = normalizeXai(values, nowMs);
	} else {
		throw ApiError.badRequest(`账户 ${providerValue || "unknown"} 不支持订阅额度查询`);
	}
	if (normalized.windows.length === 0 && normalized.balances.length === 0 && normalized.plan === null) {
		throw ApiError.unavailable(`${providerValue} 未返回可展示的订阅额度`);
	}
	return { provider: provider, ...normalized, fetched_at: new Date(nowMs).toISOString() };
}

/**
 * @param providerValue
 * @param authFile
 */
export function buildCliProxyQuotaRequests(providerValue: string, authFile: Record<string, unknown>): CliProxyQuotaRequest[] {
	const provider = providerValue.trim().toLowerCase();
	const bearerHeaders = { Authorization: "Bearer $TOKEN$", "Content-Type": "application/json" };
	if (provider === "codex") {
		const headers: Record<string, string> = {
			...bearerHeaders,
			"User-Agent": "codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal",
		};
		const metadata = codexAuthMetadata(authFile);
		const accountId = stringValue(metadata["chatgpt_account_id"] ?? metadata["chatgptAccountId"]);
		if (accountId) {
			headers["Chatgpt-Account-Id"] = accountId;
		}
		return [{ id: "usage", method: "GET", url: "https://chatgpt.com/backend-api/wham/usage", header: headers }];
	}
	if (provider === "claude" || provider === "anthropic") {
		const headers = { ...bearerHeaders, "anthropic-beta": "oauth-2025-04-20" };
		return [
			{ id: "usage", method: "GET", url: "https://api.anthropic.com/api/oauth/usage", header: headers },
			{ id: "profile", method: "GET", url: "https://api.anthropic.com/api/oauth/profile", header: headers },
		];
	}
	if (provider === "kimi") {
		return [{ id: "usage", method: "GET", url: "https://api.kimi.com/coding/v1/usages", header: bearerHeaders }];
	}
	if (provider === "antigravity") {
		const project = stringValue(authFile["project_id"] ?? authFile["projectId"]);
		if (!project) {
			throw ApiError.badRequest("Antigravity 账户缺少 project_id");
		}
		const header = {
			...bearerHeaders,
			"User-Agent": "antigravity/cli/1.0.13 (aidev_client; os_type=darwin; arch=arm64)",
		};
		const urls = [
			"https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
			"https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary",
			"https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
		];
		return urls.map((url, index) => ({
			id: `usage-${index}`,
			method: "POST",
			url: url,
			header: header,
			data: JSON.stringify({ project: project }),
			fallback_group: "antigravity",
		}));
	}
	if (provider === "xai") {
		const header: Record<string, string> = {
			Authorization: "Bearer $TOKEN$",
			"x-xai-token-auth": "xai-grok-cli",
			"x-grok-client-version": "0.2.91",
			accept: "*/*",
			"user-agent": "grok-pager/0.2.91 grok-shell/0.2.91 (macos; aarch64)",
		};
		const userId = stringValue(authFile["user_id"] ?? authFile["userId"] ?? authFile["sub"]);
		if (userId) {
			header["x-userid"] = userId;
		}
		return [
			{
				id: "weekly",
				method: "GET",
				url: "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
				header: header,
			},
			{ id: "monthly", method: "GET", url: "https://cli-chat-proxy.grok.com/v1/billing", header: header },
		];
	}
	throw ApiError.badRequest(`账户 ${providerValue || "unknown"} 不支持订阅额度查询`);
}
