/**
 * 脱敏观测与管理端点。
 *
 * - `GET /privacy/overview`：总量、按客户端 / 提供方 / 类型分布、近 24 小时曲线；
 * - `GET /privacy/requests`：请求级明细（可按客户端 / 提供方过滤）；
 * - `GET /privacy/values`：值级明细（只含类型、指纹、长度、前 3 个字符）；
 * - `GET /privacy/settings` / `PUT /privacy/settings`：总开关与识别配置。
 *
 * 全部挂在 management 鉴权之后：读操作允许 proxy admin 与只读管理员，写操作只允许 proxy admin。
 * 接口不返回任何原文，也不提供「看原文」的入口。
 */
import type { Router as ExpressRouter } from "express";
import { ApiError } from "../core/api/ApiError";
import { registerRoute } from "../core/api/registerRoute";
import type { DrizzleDb } from "../core/db/Database";
import type { CustomWord, PrivacyUserRule } from "../privacy/Detector";
import { PRIVACY_SCOPE_ENTRY_MAX_COUNT, PRIVACY_SCOPE_ENTRY_MAX_LENGTH } from "../privacy/PrivacyScope";
import { PRIVACY_KIND_NAME_PATTERN, type PrivacyKindAction } from "../privacy/PrivacyKinds";
import {
	DEFAULT_PRIVACY_MASKING_SETTINGS,
	PRIVACY_MASKING_CONFIG_KEY,
	parsePrivacyMaskingSettings,
	privacySettingsService,
} from "../privacy/PrivacyConfig";
import { PrivacyStatsRepository, type PrivacyListFilter } from "../privacy/PrivacyStatsRepository";
import { ConfigRepository } from "../repositories/ConfigRepository";

/** litellm_settings 参数名 */
const LITELLM_SETTINGS_PARAM = "litellm_settings";

/** 默认查询范围（天） */
const DEFAULT_DAYS = 7;

/** 最大查询范围（天） */
const MAX_DAYS = 90;

/** 列表默认条数 */
const DEFAULT_LIMIT = 50;

/** 列表最大条数 */
const MAX_LIMIT = 200;

/**
 * 读取普通对象。
 * @param value - 待判断的值
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 解析正整数查询参数并夹到范围内。
 * @param value - 原始值
 * @param fallback - 缺省值
 * @param min - 最小值
 * @param max - 最大值
 */
function parseBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
	const parsed = typeof value === "string" ? Number.parseInt(value, 10) : typeof value === "number" ? value : Number.NaN;
	if (!Number.isFinite(parsed)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/**
 * 读取字符串查询参数。
 * @param value - 原始值
 */
function parseText(value: unknown): string | undefined {
	if (typeof value === "string" && value.trim().length > 0) {
		return value.trim();
	}
	return undefined;
}

/**
 * 把查询参数解析为列表过滤条件。
 * @param query - Express 查询对象
 */
function parseListFilter(query: Record<string, unknown>): PrivacyListFilter {
	return {
		days: parseBoundedInt(query["days"], DEFAULT_DAYS, 1, MAX_DAYS),
		client: parseText(query["client"]),
		provider: parseText(query["provider"]),
		kind: parseText(query["kind"]),
		model: parseText(query["model"]),
		action: parseText(query["action"]),
		sort: parseText(query["sort"]),
		order: query["order"] === "asc" ? "asc" : "desc",
		limit: parseBoundedInt(query["limit"], DEFAULT_LIMIT, 1, MAX_LIMIT),
		offset: parseBoundedInt(query["offset"], 0, 0, Number.MAX_SAFE_INTEGER),
	};
}

/**
 * 解析总开关。
 * @param value - 原始值
 * @throws {ApiError} enabled 不是布尔值
 */
function parseEnabled(value: unknown): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	throw ApiError.badRequest("enabled must be a boolean");
}

/**
 * 解析处置动作。
 * @param value - 原始值
 * @throws {ApiError} action 不是 mask/warn
 */
function parseAction(value: unknown): "mask" | "warn" {
	if (value === "mask" || value === "warn") {
		return value;
	}
	throw ApiError.badRequest("action must be 'mask' or 'warn'");
}

/**
 * 解析按类型处置。
 * @param value - 原始值
 * @throws {ApiError} 类型或动作非法
 */
function parseKinds(value: unknown): Record<string, PrivacyKindAction> {
	if (!isRecord(value)) {
		throw ApiError.badRequest("kinds must be an object");
	}
	const result: Record<string, PrivacyKindAction> = {};
	for (const [rawKey, rawAction] of Object.entries(value)) {
		const kind = rawKey.trim().toUpperCase();
		if (!PRIVACY_KIND_NAME_PATTERN.test(kind)) {
			throw ApiError.badRequest(`Invalid privacy kind: ${rawKey}`);
		}
		if (rawAction !== "mask" && rawAction !== "warn" && rawAction !== "off" && rawAction !== "block") {
			throw ApiError.badRequest(`Invalid action for ${rawKey}: ${String(rawAction)}`);
		}
		result[kind] = rawAction;
	}
	return result;
}

/**
 * 解析自定义词条。
 * @param value - 原始值
 * @throws {ApiError} 词条格式非法
 */
function parseCustomWords(value: unknown): CustomWord[] {
	if (!Array.isArray(value)) {
		throw ApiError.badRequest("custom_words must be an array");
	}
	const words: CustomWord[] = [];
	for (const item of value) {
		if (typeof item === "string") {
			const trimmed = item.trim();
			if (trimmed.length < 2 || trimmed.length > 256) {
				throw ApiError.badRequest("custom_words entries must be 2-256 characters");
			}
			words.push({ value: trimmed });
			continue;
		}
		if (!isRecord(item) || typeof item["value"] !== "string") {
			throw ApiError.badRequest("custom_words entries must be strings or { value, kind }");
		}
		const trimmed = item["value"].trim();
		if (trimmed.length < 2 || trimmed.length > 256) {
			throw ApiError.badRequest("custom_words entries must be 2-256 characters");
		}
		const rawKind = typeof item["kind"] === "string" ? item["kind"].trim().toUpperCase() : "";
		const kind = PRIVACY_KIND_NAME_PATTERN.test(rawKind) ? rawKind : undefined;
		words.push(kind === undefined ? { value: trimmed } : { value: trimmed, kind: kind });
		if (words.length >= 200) {
			throw ApiError.badRequest("custom_words supports at most 200 entries");
		}
	}
	return words;
}

/**
 * 解析永不脱敏列表。
 * @param value - 原始值
 * @throws {ApiError} 白名单格式非法
 */
function parseNeverMask(value: unknown): string[] {
	if (!Array.isArray(value)) {
		throw ApiError.badRequest("never_mask must be an array");
	}
	const result: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") {
			throw ApiError.badRequest("never_mask entries must be strings");
		}
		const trimmed = item.trim();
		if (trimmed.length === 0 || trimmed.length > 256) {
			continue;
		}
		result.push(trimmed);
		if (result.length >= 200) {
			break;
		}
	}
	return result;
}

/**
 * 解析用户规则：前缀与正则二选一，正则需要能编译。
 * @param value - 原始值
 * @throws {ApiError} 规则格式非法或正则无法编译
 */
function parseRules(value: unknown): PrivacyUserRule[] {
	if (!Array.isArray(value)) {
		throw ApiError.badRequest("rules must be an array");
	}
	const rules: PrivacyUserRule[] = [];
	for (const item of value) {
		if (!isRecord(item)) {
			throw ApiError.badRequest("rules entries must be objects");
		}
		const kind = typeof item["kind"] === "string" ? item["kind"].trim().toUpperCase() : "";
		if (!PRIVACY_KIND_NAME_PATTERN.test(kind)) {
			throw ApiError.badRequest("rules[].kind must be an upper-case identifier like ORG_ID");
		}
		const prefix = typeof item["prefix"] === "string" ? item["prefix"].trim() : "";
		const regex = typeof item["regex"] === "string" ? item["regex"].trim() : "";
		if ((prefix.length === 0) === (regex.length === 0)) {
			throw ApiError.badRequest("each rule needs exactly one of prefix or regex");
		}
		if (prefix.length > 64) {
			throw ApiError.badRequest("rules[].prefix must be at most 64 characters");
		}
		if (regex.length > 200) {
			throw ApiError.badRequest("rules[].regex must be at most 200 characters");
		}
		if (regex.length > 0) {
			try {
				new RegExp(regex, "gd");
			} catch {
				throw ApiError.badRequest(`rules[].regex does not compile: ${regex}`);
			}
		}
		rules.push(prefix.length > 0 ? { kind: kind, prefix: prefix } : { kind: kind, regex: regex });
		if (rules.length >= 50) {
			throw ApiError.badRequest("rules supports at most 50 entries");
		}
	}
	return rules;
}

/**
 * 解析生效范围列表（提供方 / 模型）：每项 1-64 字符，最多 50 条。
 * @param value - 原始值
 * @param field - 字段名，用于报错
 * @throws {ApiError} 非数组或条目非法
 */
function parseScopeList(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) {
		throw ApiError.badRequest(`${field} must be an array`);
	}
	const result: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") {
			throw ApiError.badRequest(`${field} entries must be strings`);
		}
		const trimmed = item.trim();
		if (trimmed.length === 0) {
			throw ApiError.badRequest(`${field} entries must not be empty`);
		}
		if (trimmed.length > PRIVACY_SCOPE_ENTRY_MAX_LENGTH) {
			throw ApiError.badRequest(`${field} entries must be at most ${PRIVACY_SCOPE_ENTRY_MAX_LENGTH} characters`);
		}
		if (!result.includes(trimmed)) {
			result.push(trimmed);
		}
		if (result.length > PRIVACY_SCOPE_ENTRY_MAX_COUNT) {
			throw ApiError.badRequest(`${field} supports at most ${PRIVACY_SCOPE_ENTRY_MAX_COUNT} entries`);
		}
	}
	return result;
}

/**
 * 装配 PUT /privacy/settings 的写入内容。
 * @param body - 请求体
 * @throws {ApiError} 字段校验失败
 */
function buildSettingsPatch(body: Record<string, unknown>): Record<string, unknown> {
	const patch: Record<string, unknown> = {};
	if (body["enabled"] !== undefined) {
		patch["enabled"] = parseEnabled(body["enabled"]);
	}
	if (body["action"] !== undefined) {
		patch["action"] = parseAction(body["action"]);
	}
	if (body["kinds"] !== undefined) {
		patch["kinds"] = parseKinds(body["kinds"]);
	}
	if (body["custom_words"] !== undefined) {
		patch["custom_words"] = parseCustomWords(body["custom_words"]);
	}
	if (body["never_mask"] !== undefined) {
		patch["never_mask"] = parseNeverMask(body["never_mask"]);
	}
	if (body["mask_configured_secrets"] !== undefined) {
		if (typeof body["mask_configured_secrets"] !== "boolean") {
			throw ApiError.badRequest("mask_configured_secrets must be a boolean");
		}
		patch["mask_configured_secrets"] = body["mask_configured_secrets"];
	}
	if (body["fail_closed"] !== undefined) {
		if (typeof body["fail_closed"] !== "boolean") {
			throw ApiError.badRequest("fail_closed must be a boolean");
		}
		patch["fail_closed"] = body["fail_closed"];
	}
	if (body["rules"] !== undefined) {
		patch["rules"] = parseRules(body["rules"]);
	}
	if (body["shape"] !== undefined) {
		if (typeof body["shape"] !== "boolean") {
			throw ApiError.badRequest("shape must be a boolean");
		}
		patch["shape"] = body["shape"];
	}
	if (body["providers"] !== undefined) {
		patch["providers"] = parseScopeList(body["providers"], "providers");
	}
	if (body["models"] !== undefined) {
		patch["models"] = parseScopeList(body["models"], "models");
	}
	if (body["retention_days"] !== undefined) {
		const days = Number(body["retention_days"]);
		if (!Number.isFinite(days) || days < 1 || days > 365) {
			throw ApiError.badRequest("retention_days must be between 1 and 365");
		}
		patch["retention_days"] = Math.round(days);
	}
	return patch;
}

/**
 * 把生效配置转换成接口输出（字段名保持 snake_case，与配置文件一致）。
 * @param settings - 生效配置
 */
function serializeSettings(settings: ReturnType<typeof parsePrivacyMaskingSettings>): Record<string, unknown> {
	return {
		enabled: settings.enabled,
		action: settings.action,
		kinds: settings.kinds,
		custom_words: settings.customWords,
		never_mask: settings.neverMask,
		mask_configured_secrets: settings.maskConfiguredSecrets,
		fail_closed: settings.failClosed,
		retention_days: settings.retentionDays,
		rules: settings.rules,
		shape: settings.shape,
		providers: settings.providers,
		models: settings.models,
	};
}

/**
 * 注册脱敏端点。
 * @param router - Express 路由
 * @param db - 数据库实例
 */
export function registerPrivacyRoutes(router: ExpressRouter, db: DrizzleDb): void {
	const repository = new PrivacyStatsRepository(db);
	const configRepository = new ConfigRepository(db);

	registerRoute(router, { method: "get", path: "/privacy/overview" }, async (req) => {
		const days = parseBoundedInt(req.query["days"], DEFAULT_DAYS, 1, MAX_DAYS);
		const overview = await repository.overview(days);
		return { days: days, ...overview };
	});

	registerRoute(router, { method: "get", path: "/privacy/requests" }, async (req) => {
		const filter = parseListFilter(req.query as Record<string, unknown>);
		const rows = await repository.listRequests(filter);
		return { rows: rows, has_more: rows.length === filter.limit, limit: filter.limit, offset: filter.offset };
	});

	registerRoute(router, { method: "get", path: "/privacy/values" }, async (req) => {
		const filter = parseListFilter(req.query as Record<string, unknown>);
		const rows = await repository.listValues(filter);
		return { rows: rows, has_more: rows.length === filter.limit, limit: filter.limit, offset: filter.offset };
	});

	registerRoute(router, { method: "get", path: "/privacy/settings" }, async () => {
		const litellmSettings = await configRepository.getParam(LITELLM_SETTINGS_PARAM);
		const raw = litellmSettings?.[PRIVACY_MASKING_CONFIG_KEY];
		const settings = parsePrivacyMaskingSettings(raw ?? {});
		return {
			values: serializeSettings(settings),
			// 默认值随接口返回，便于前端展示「默认开启」的语义
			defaults: serializeSettings(DEFAULT_PRIVACY_MASKING_SETTINGS),
		};
	});

	registerRoute(router, { method: "put", path: "/privacy/settings" }, async (req) => {
		const body = isRecord(req.body) ? req.body : {};
		const patch = buildSettingsPatch(body);
		const existing = (await configRepository.getParam(LITELLM_SETTINGS_PARAM)) ?? {};
		const currentRaw = isRecord(existing[PRIVACY_MASKING_CONFIG_KEY])
			? (existing[PRIVACY_MASKING_CONFIG_KEY] as Record<string, unknown>)
			: {};
		const nextRaw = { ...currentRaw, ...patch };
		await configRepository.upsertParam(LITELLM_SETTINGS_PARAM, { ...existing, [PRIVACY_MASKING_CONFIG_KEY]: nextRaw });
		privacySettingsService.invalidate();
		const settings = parsePrivacyMaskingSettings(nextRaw);
		return { values: serializeSettings(settings) };
	});
}
