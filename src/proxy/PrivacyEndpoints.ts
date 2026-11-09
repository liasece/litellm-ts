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
import type { CustomWord } from "../privacy/Detector";
import { PRIVACY_KINDS, type PrivacyKind, type PrivacyKindAction } from "../privacy/PrivacyKinds";
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
function parseKinds(value: unknown): Partial<Record<PrivacyKind, PrivacyKindAction>> {
	if (!isRecord(value)) {
		throw ApiError.badRequest("kinds must be an object");
	}
	const result: Partial<Record<PrivacyKind, PrivacyKindAction>> = {};
	for (const [rawKey, rawAction] of Object.entries(value)) {
		const kind = rawKey.toUpperCase();
		if (!(PRIVACY_KINDS as readonly string[]).includes(kind)) {
			throw ApiError.badRequest(`Unknown privacy kind: ${rawKey}`);
		}
		if (rawAction !== "mask" && rawAction !== "warn" && rawAction !== "off") {
			throw ApiError.badRequest(`Invalid action for ${rawKey}: ${String(rawAction)}`);
		}
		result[kind as PrivacyKind] = rawAction;
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
		const rawKind = typeof item["kind"] === "string" ? item["kind"].toUpperCase() : "";
		const kind = (PRIVACY_KINDS as readonly string[]).includes(rawKind) ? (rawKind as PrivacyKind) : undefined;
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
		const currentRaw = isRecord(existing[PRIVACY_MASKING_CONFIG_KEY]) ? (existing[PRIVACY_MASKING_CONFIG_KEY] as Record<string, unknown>) : {};
		const nextRaw = { ...currentRaw, ...patch };
		await configRepository.upsertParam(LITELLM_SETTINGS_PARAM, { ...existing, [PRIVACY_MASKING_CONFIG_KEY]: nextRaw });
		privacySettingsService.invalidate();
		const settings = parsePrivacyMaskingSettings(nextRaw);
		return { values: serializeSettings(settings) };
	});
}
