/**
 * 原生订阅额度查询。
 *
 * 这一层直接用账号凭据打上游额度接口，替代原先「网关 → CPA 管理接口 → 插件」的链路：
 * - 五家 OAuth 来源的请求 URL / 请求头沿用 {@link buildCliProxyQuotaRequests}；
 * - CommandCode / OpenCode Go 的账户接口按插件实现补齐（同一 authority，Bearer key）；
 * - 归一化复用现有 `normalizeCliProxy*` 函数，按 provider 分派。
 *
 * 凭据只出现在请求头里：`$TOKEN$` 在发请求前替换，错误信息、URL、返回值都不带 key。
 * 请求逐个串行执行，`fallback_group` 内的后续请求在组内首次成功后跳过（Antigravity
 * 三个区域域名即按此兜底）。
 *
 * 为了不与 `src/cliproxy` 产生两份会漂移的协议定义，这里直接复用它的请求构造与
 * 归一化实现；等迁移把那段实现搬进本目录时，替换这些导入即可，本文件的执行与分派逻辑
 * 不需要改。
 */

import {
	buildCliProxyQuotaRequests,
	normalizeCliProxyCommandCodeQuota,
	normalizeCliProxyPluginQuota,
	normalizeCliProxyQuota,
	type CliProxyQuotaRequest,
} from "../../../cliproxy/CliProxyQuota";
import type { CliProxyAccountQuota } from "../../../cliproxy/CliProxyTypes";
import { ApiError } from "../../../core/api/ApiError";
import { COMMANDCODE_API_BASE, OPENCODE_API_BASE } from "../catalog/dynamicCatalog";
import type { SubscriptionAccount, SubscriptionSource } from "../types";

/** 单次额度接口超时（毫秒）：管理面查询要快速失败，不继承上游请求预算。 */
export const QUOTA_REQUEST_TIMEOUT_MS = 30_000;

/** CommandCode 账户接口路径；与 `provider/v1` 同 authority，但在 OpenAI 兼容面之外。 */
const COMMANDCODE_ACCOUNT_PATHS = {
	credits: "/alpha/billing/credits",
	subscription: "/alpha/billing/subscriptions",
	whoami: "/alpha/whoami?limits=1",
} as const;

/** OpenCode Go 额度路径（相对 `…/zen/go/v1`）。 */
const OPENCODE_USAGE_PATH = "/usage";

/** OpenCode Go 的额度窗口名，顺序即展示顺序。 */
const OPENCODE_USAGE_WINDOWS: readonly string[] = ["rolling", "weekly", "monthly"];

/** CommandCode 套餐表：planId → [展示名, 月度计划额度]。仅作展示分母。 */
const COMMANDCODE_PLANS: Readonly<Record<string, readonly [string, number]>> = {
	"individual-goat": ["GOAT", 70],
	"individual-pro": ["Pro", 30],
	"individual-pro-v1": ["Pro", 80],
	"individual-provider": ["Provider", 15],
	"individual-max": ["Max", 150],
	"individual-ultra": ["Ultra", 300],
	"teams-pro": ["Teams Pro", 40],
};

/** 已收集的额度响应。 */
interface QuotaPayload {
	/** 请求 id；归一化按 id 取用。 */
	readonly id: string;
	/** 已解析的响应体。 */
	readonly body: unknown;
}

/** 额度请求；`optional` 的失败不阻断整体结果。 */
interface QuotaCall extends CliProxyQuotaRequest {
	/** 失败时是否允许继续（best-effort 请求）。 */
	readonly optional?: boolean;
}

/** 一个 CommandCode 套餐的身份与额度。 */
interface CommandCodePlan {
	/** 展示名；未知套餐时缺省。 */
	readonly name?: string;
	/** 月度计划额度；未知套餐为 0。 */
	readonly allowance: number;
}

/** CommandCode 账户快照：额度结构 + 账号标识。 */
interface CommandCodeSnapshot {
	/** 归一化前的 `usage` 结构。 */
	readonly usage: Record<string, unknown>;
	/** 展示标签（`<org> (<email>)`）。 */
	readonly label?: string;
	/** 邮箱。 */
	readonly email?: string;
}

/**
 * 查询一个订阅账号的额度。
 * @param source - 账号来源
 * @param account - 账号
 * @param credential - 已就绪的凭据（OAuth access token 或 API key）
 * @param fetchImpl - 注入的 fetch；测试使用
 * @returns 归一化后的额度
 * @throws ApiError 上游拒绝、响应无效或该来源不支持额度查询时抛出
 */
export function quotaForAccount(
	source: SubscriptionSource,
	account: SubscriptionAccount,
	credential: string,
	fetchImpl: typeof fetch = fetch,
): Promise<CliProxyAccountQuota> {
	return executeQuotaRequests(source, account.raw, credential, fetchImpl);
}

/**
 * 执行某来源的额度查询。
 *
 * 请求按构造顺序串行发出；必选请求失败立即抛出，`optional` 请求与 `fallback_group`
 * 请求失败只丢弃该次响应。所有响应收齐后按 provider 分派归一化。
 * @param provider - 来源/provider 名（大小写与空白不敏感）
 * @param authFile - 账号 auth JSON；提供账户元数据（如 Codex account id、Antigravity project）
 * @param credential - 已就绪的凭据；用于替换请求头里的 `$TOKEN$`
 * @param fetchImpl - 注入的 fetch；测试使用
 * @returns 归一化后的额度
 * @throws ApiError 凭据缺失、必选请求失败、响应无效或该来源不支持额度查询时抛出
 */
export async function executeQuotaRequests(
	provider: string,
	authFile: Record<string, unknown>,
	credential: string,
	fetchImpl: typeof fetch = fetch,
): Promise<CliProxyAccountQuota> {
	const name = provider.trim().toLowerCase();
	const token = credential.trim();
	if (token.length === 0) {
		throw ApiError.unavailable(`${name || "订阅"} 账号缺少可用凭据`);
	}
	const payloads: QuotaPayload[] = [];
	const satisfied = new Set<string>();
	for (const call of buildQuotaCalls(name, authFile)) {
		const group = call.fallback_group;
		if (group !== undefined && satisfied.has(group)) {
			continue;
		}
		try {
			const body = await callQuotaEndpoint(name, call, token, fetchImpl);
			payloads.push({ id: call.id, body: body });
			if (group !== undefined) {
				satisfied.add(group);
			}
		} catch (error) {
			if (call.optional !== true && group === undefined) {
				throw error;
			}
		}
	}
	return normalizeQuotaPayloads(name, payloads, authFile);
}

/**
 * 构造某来源的额度请求。
 * @param provider - 已归一化的 provider 名
 * @param authFile - 账号 auth JSON
 * @returns 有序请求列表
 * @throws ApiError 该来源不支持额度查询时抛出
 */
function buildQuotaCalls(provider: string, authFile: Record<string, unknown>): QuotaCall[] {
	const bearer: Record<string, string> = { Authorization: "Bearer $TOKEN$", Accept: "application/json" };
	if (provider === "commandcode") {
		const base = commandCodeAccountBase();
		return [
			{ id: "credits", method: "GET", url: `${base}${COMMANDCODE_ACCOUNT_PATHS.credits}`, header: bearer },
			{
				id: "subscription",
				method: "GET",
				url: `${base}${COMMANDCODE_ACCOUNT_PATHS.subscription}`,
				header: bearer,
				optional: true,
			},
			{ id: "whoami", method: "GET", url: `${base}${COMMANDCODE_ACCOUNT_PATHS.whoami}`, header: bearer, optional: true },
		];
	}
	if (provider === "opencode-go") {
		return [{ id: "usage", method: "GET", url: `${openCodeBase()}${OPENCODE_USAGE_PATH}`, header: bearer }];
	}
	// 五家 OAuth 来源沿用 CLIProxy 的请求定义；profile 与 xAI 的两次计费查询都是 best-effort。
	return buildCliProxyQuotaRequests(provider, authFile).map((request) => ({
		...request,
		optional: request.id === "profile" || provider === "xai",
	}));
}

/**
 * 从 provider 基址推导 CommandCode 账户接口根。
 *
 * 账户面与 OpenAI 兼容面同 authority，去掉 `/provider/v1` 后即可复用同一主机，
 * 因此换成自建/预发基址时不需要第二个配置项。
 * @returns 账户接口根，例如 `https://api.commandcode.ai`
 */
function commandCodeAccountBase(): string {
	const parsed = new URL(COMMANDCODE_API_BASE);
	const path = parsed.pathname.replace(/\/+$/, "");
	const stripped = path.endsWith("/provider/v1")
		? path.slice(0, -"/provider/v1".length)
		: path.endsWith("/provider")
			? path.slice(0, -"/provider".length)
			: path;
	return `${parsed.origin}${stripped}`;
}

/**
 * OpenCode Go 上游基址（去掉尾部斜杠）。
 */
function openCodeBase(): string {
	return OPENCODE_API_BASE.replace(/\/+$/, "");
}

/**
 * 发起一次额度请求并解析 JSON。
 * @param provider - provider 名；用于错误信息
 * @param call - 请求定义
 * @param token - 凭据
 * @param fetchImpl - fetch 实现
 * @returns 已解析的响应体
 * @throws ApiError 网络失败、非 2xx、空响应或非法 JSON 时抛出
 */
async function callQuotaEndpoint(
	provider: string,
	call: QuotaCall,
	token: string,
	fetchImpl: typeof fetch,
): Promise<unknown> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), QUOTA_REQUEST_TIMEOUT_MS);
	try {
		const response = await fetchImpl(call.url, {
			method: call.method,
			headers: withCredential(call.header, token),
			...(call.data === undefined ? {} : { body: call.data }),
			signal: controller.signal,
		});
		if (!response.ok) {
			throw ApiError.unavailable(`${provider} 订阅额度查询失败: HTTP ${response.status}`);
		}
		const text = await response.text();
		if (text.trim().length === 0) {
			throw ApiError.unavailable(`${provider} 订阅额度响应为空`);
		}
		try {
			return JSON.parse(text) as unknown;
		} catch {
			throw ApiError.unavailable(`${provider} 订阅额度响应无效`);
		}
	} catch (error) {
		if (error instanceof ApiError) {
			throw error;
		}
		throw ApiError.unavailable(`${provider} 订阅额度查询失败: ${describeFailure(error)}`);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * 把请求头里的 `$TOKEN$` 换成实际凭据。
 * @param header - 请求头模板
 * @param token - 凭据
 * @returns 替换后的请求头
 */
function withCredential(header: Record<string, string>, token: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(header)) {
		result[name] = value.includes("$TOKEN$") ? value.replaceAll("$TOKEN$", token) : value;
	}
	return result;
}

/**
 * 按 provider 分派归一化。
 * @param provider - provider 名
 * @param payloads - 已收集的响应
 * @param authFile - 账号 auth JSON
 * @returns 归一化后的额度
 * @throws ApiError 响应无法归一化或该来源不支持时抛出
 */
function normalizeQuotaPayloads(
	provider: string,
	payloads: QuotaPayload[],
	authFile: Record<string, unknown>,
): CliProxyAccountQuota {
	if (provider === "commandcode") {
		return normalizeCommandCodeQuota(payloads, authFile);
	}
	if (provider === "opencode-go") {
		return normalizeOpenCodeQuota(payloads);
	}
	return normalizeCliProxyQuota(provider, payloads, authFile);
}

/**
 * CommandCode：账户接口响应 → 插件格式的账号卡片 → 现有归一化函数。
 *
 * 这里只负责补上插件侧派生过的字段（套餐名/额度、月度窗口、展示标签），
 * 百分比与余额口径仍由 `normalizeCliProxyCommandCodeQuota` 决定。
 * @param payloads - credits / subscription / whoami 响应
 * @param authFile - 账号 auth JSON
 * @returns 归一化后的额度
 * @throws ApiError credits 响应无效、卡片不可解析或上游报了账户错误时抛出
 */
function normalizeCommandCodeQuota(payloads: QuotaPayload[], authFile: Record<string, unknown>): CliProxyAccountQuota {
	const credits = recordOf(payloadById(payloads, "credits"));
	if (!credits) {
		throw ApiError.unavailable("CommandCode 额度响应无效");
	}
	const snapshot = commandCodeSnapshot(
		credits,
		recordOf(payloadById(payloads, "subscription")),
		recordOf(payloadById(payloads, "whoami")),
	);
	const authIndex = commandCodeAuthIndex(authFile);
	const card: Record<string, unknown> = { key_id: authIndex, usage: snapshot.usage };
	if (snapshot.label !== undefined) {
		card["label"] = snapshot.label;
	}
	if (snapshot.email !== undefined) {
		card["email"] = snapshot.email;
	}
	const normalized = normalizeCliProxyCommandCodeQuota(card, authIndex);
	if (!normalized || (normalized.windows.length === 0 && normalized.balances.length === 0 && normalized.plan === null)) {
		throw ApiError.unavailable("CommandCode 未返回可展示的订阅额度");
	}
	return { provider: "commandcode", ...normalized, fetched_at: new Date().toISOString() };
}

/**
 * 组装 CommandCode 账户快照。
 * @param credits - `/alpha/billing/credits` 响应
 * @param subscription - `/alpha/billing/subscriptions` 响应；缺失时只丢套餐信息
 * @param whoami - `/alpha/whoami?limits=1` 响应；缺失时只丢展示身份
 * @returns 账号快照
 */
function commandCodeSnapshot(
	credits: Record<string, unknown>,
	subscription: Record<string, unknown> | null,
	whoami: Record<string, unknown> | null,
): CommandCodeSnapshot {
	const credit = recordOf(credits["credits"]);
	const windowLimits = recordOf(credits["windowLimits"]);
	const subscriptionData = recordOf(subscription?.["data"]);
	const plan = commandCodePlan(textOf(subscriptionData?.["planId"]));
	const creditsLeft = numberValue(credit?.["monthlyCredits"]) ?? 0;
	const purchased = numberValue(credit?.["purchasedCredits"]) ?? 0;
	const periodEnd = isoTimestamp(textOf(subscriptionData?.["currentPeriodEnd"]));
	const month = commandCodeMonthWindow(plan.allowance, creditsLeft, purchased, periodEnd);
	const usage: Record<string, unknown> = {
		credits_left: creditsLeft,
		purchased_credits: purchased,
		five_hour: commandCodeWindow(recordOf(windowLimits?.["fiveHour"])),
		weekly: commandCodeWindow(recordOf(windowLimits?.["weekly"])),
	};
	if (plan.name !== undefined) {
		usage["plan"] = plan.name;
	}
	if (plan.allowance > 0) {
		usage["plan_credits"] = plan.allowance;
	}
	if (month !== undefined) {
		usage["month"] = month;
	}
	const user = recordOf(whoami?.["user"]);
	const org = recordOf(whoami?.["org"]);
	const email = textOf(user?.["email"]);
	const orgLogin = textOf(org?.["login"]);
	const label = email !== undefined && orgLogin !== undefined ? `${orgLogin} (${email})` : email;
	return {
		usage: usage,
		...(label === undefined ? {} : { label: label }),
		...(email === undefined ? {} : { email: email }),
	};
}

/**
 * 把一个账户窗口映射为归一化函数认得的形状。
 *
 * 只给 used/cap，让 `normalizeCliProxyCommandCodeQuota` 自己算百分比，避免两处取整口径；
 * cap 缺失（不限额或上游未给）时返回 undefined，宁可不画也不编一个没有分母的进度。
 * @param window - 账户窗口
 * @returns `{used, cap, resets_at?}`；窗口缺失或无 cap 时为 undefined
 */
function commandCodeWindow(window: Record<string, unknown> | null): Record<string, unknown> | undefined {
	if (!window) {
		return undefined;
	}
	const used = numberValue(window["used"]) ?? 0;
	const cap = numberValue(window["cap"]) ?? 0;
	if (cap <= 0) {
		return undefined;
	}
	const resetsAt = isoTimestampFromMillis(numberValue(window["resetAt"]));
	return { used: used, cap: cap, ...(resetsAt === undefined ? {} : { resets_at: resetsAt }) };
}

/**
 * 月度计划额度窗口。
 *
 * CommandCode 只报「剩余计划额度」，池子按供应商 CLI 的口径推导：
 * `pool = max(allowance, creditsLeft) + purchased`，consumed = pool − 剩余。
 * 未知套餐没有分母，直接不产出窗口。
 * @param allowance - 套餐月度额度
 * @param creditsLeft - 剩余计划额度
 * @param purchased - 额外购买额度
 * @param periodEnd - 订阅当前周期结束时间
 * @returns `{used, cap, resets_at?}`；无法推导时为 undefined
 */
function commandCodeMonthWindow(
	allowance: number,
	creditsLeft: number,
	purchased: number,
	periodEnd: string | undefined,
): Record<string, unknown> | undefined {
	if (allowance <= 0) {
		return undefined;
	}
	const remaining = creditsLeft + purchased;
	const pool = Math.max(allowance, creditsLeft) + purchased;
	if (pool <= 0) {
		return undefined;
	}
	return {
		used: Math.max(0, pool - remaining),
		cap: pool,
		...(periodEnd === undefined ? {} : { resets_at: periodEnd }),
	};
}

/**
 * 解析 CommandCode 套餐。
 * @param planId - 上游 planId
 * @returns 套餐展示名与月度额度；未知套餐只返回额度 0
 */
function commandCodePlan(planId: string | undefined): CommandCodePlan {
	if (planId === undefined) {
		return { allowance: 0 };
	}
	const id = planId.replaceAll("_", "-").toLowerCase();
	const exact = COMMANDCODE_PLANS[id];
	if (exact) {
		return { name: exact[0], allowance: exact[1] };
	}
	let best: readonly [string, number] | undefined;
	let bestLength = 0;
	for (const [key, value] of Object.entries(COMMANDCODE_PLANS)) {
		if (key.length > bestLength && id.startsWith(key)) {
			best = value;
			bestLength = key.length;
		}
	}
	return best ? { name: best[0], allowance: best[1] } : { allowance: 0 };
}

/**
 * 账户卡片里的 key_id：优先用 auth 索引，退回到账号 id。
 * @param authFile - 账号 auth JSON
 * @returns key_id；都没有时为空串
 */
function commandCodeAuthIndex(authFile: Record<string, unknown>): string {
	for (const key of ["auth_index", "authIndex", "key_id", "id"]) {
		const value = textOf(authFile[key]);
		if (value !== undefined) {
			return value;
		}
	}
	return "";
}

/**
 * OpenCode Go：`/usage` 响应 → 插件格式的 quota 结构 → 现有归一化函数。
 * @param payloads - 已收集的响应
 * @returns 归一化后的额度
 * @throws ApiError 响应缺少窗口或无法归一化时抛出
 */
function normalizeOpenCodeQuota(payloads: QuotaPayload[]): CliProxyAccountQuota {
	const usage = recordOf(recordOf(payloadById(payloads, "usage"))?.["usage"]);
	if (!usage) {
		throw ApiError.unavailable("OpenCode Go 额度响应无效");
	}
	const buckets: Record<string, unknown>[] = [];
	for (const windowName of OPENCODE_USAGE_WINDOWS) {
		const window = recordOf(usage[windowName]);
		const percent = numberValue(window?.["percent"]);
		if (!window || percent === undefined || percent < 0 || percent > 100) {
			continue;
		}
		const resetsAt = isoTimestamp(textOf(window["resetsAt"]));
		buckets.push({
			window: windowName,
			remainingFraction: 1 - percent / 100,
			...(resetsAt === undefined ? {} : { resetTime: resetsAt }),
		});
	}
	if (buckets.length === 0) {
		throw ApiError.unavailable("OpenCode Go 未返回可展示的订阅额度");
	}
	const normalized = normalizeCliProxyPluginQuota("opencode-go", {
		subscription: { plan: "Go" },
		groups: [{ displayName: "OpenCode Go", buckets: buckets }],
	});
	if (!normalized) {
		throw ApiError.unavailable("OpenCode Go 未返回可展示的订阅额度");
	}
	return { provider: "opencode-go", ...normalized, fetched_at: new Date().toISOString() };
}

/**
 * 按 id 取一条响应体。
 * @param payloads - 已收集的响应
 * @param id - 请求 id
 * @returns 响应体；没有该 id 时为 undefined
 */
function payloadById(payloads: readonly QuotaPayload[], id: string): unknown {
	return payloads.find((payload) => payload.id === id)?.body;
}

/**
 * 把毫秒时间戳转成 ISO 字符串。
 * @param value - 毫秒时间戳
 * @returns ISO 字符串；缺失或非法时为 undefined
 */
function isoTimestampFromMillis(value: number | undefined): string | undefined {
	if (value === undefined || value <= 0) {
		return undefined;
	}
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * 把上游时间字符串转成 ISO 字符串。
 * @param value - 原始时间字符串
 * @returns ISO 字符串；缺失或无法解析时为 undefined
 */
function isoTimestamp(value: string | undefined): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

/**
 * 是否为普通对象。
 * @param value - 待判定值
 */
function recordOf(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * 非空字符串。
 * @param value - 待判定值
 */
function textOf(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 有限数字（兼容数字字符串）。
 * @param value - 待判定值
 */
function numberValue(value: unknown): number | undefined {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (typeof value !== "string" || value.trim() === "") {
		return undefined;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 把未知错误转成可展示的原因，不回显请求头。
 * @param error - 捕获到的错误
 */
function describeFailure(error: unknown): string {
	if (error instanceof Error) {
		if (error.name === "AbortError") {
			return "请求超时";
		}
		return error.message.trim().length > 0 ? error.message : error.name;
	}
	return "网络请求失败";
}
