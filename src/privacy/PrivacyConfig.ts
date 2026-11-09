/**
 * 脱敏配置的解析与快照。
 *
 * 配置写在 `litellm_settings.privacy_masking`（DB 优先，yaml 兜底），
 * 与 WebUI 其他设置同源；`PRIVACY_MASKING_ENABLED` 提供不依赖数据库的紧急开关。
 * 读取带 2 秒 TTL：管理页保存后立即失效，普通请求不会每次打一次配置查询。
 */
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import type { CustomWord } from "./Detector";
import { PRIVACY_KINDS, type PrivacyKind, type PrivacyKindAction } from "./PrivacyKinds";

/** 配置段在 litellm_settings 中的键名 */
export const PRIVACY_MASKING_CONFIG_KEY = "privacy_masking";

/** 快照 TTL（毫秒） */
const SETTINGS_TTL_MS = 2_000;

/** 生效的脱敏配置 */
export interface PrivacyMaskingSettings {
	/** 总开关 */
	readonly enabled: boolean;
	/** 默认处置；mask 替换为占位符，warn 只统计不替换 */
	readonly action: "mask" | "warn";
	/** 按类型的处置覆盖 */
	readonly kinds: Readonly<Partial<Record<PrivacyKind, PrivacyKindAction>>>;
	/** 永不脱敏的字面量 */
	readonly neverMask: readonly string[];
	/** 管理员维护的自定义词条 */
	readonly customWords: readonly CustomWord[];
	/** 是否精确匹配网关自身配置的凭据 */
	readonly maskConfiguredSecrets: boolean;
	/** 脱敏流程自身失败时是否拒绝请求 */
	readonly failClosed: boolean;
	/** 观测数据保留天数 */
	readonly retentionDays: number;
}

/** 默认配置：默认开启且直接替换 */
export const DEFAULT_PRIVACY_MASKING_SETTINGS: PrivacyMaskingSettings = {
	enabled: true,
	action: "mask",
	kinds: {},
	neverMask: [],
	customWords: [],
	maskConfiguredSecrets: true,
	failClosed: true,
	retentionDays: 30,
};

/**
 * 解析布尔值；无法识别时返回缺省值。
 * @param value - 原始值
 * @param fallback - 缺省值
 */
function parseBoolean(value: unknown, fallback: boolean): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
			return true;
		}
		if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
			return false;
		}
	}
	return fallback;
}

/**
 * 解析字符串数组，忽略非字符串项并做长度约束。
 * @param value - 原始值
 * @param maxItems - 最大条数
 * @param maxLength - 单条最大长度
 */
function parseStringList(value: unknown, maxItems: number, maxLength: number): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const result: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") {
			continue;
		}
		const trimmed = item.trim();
		if (trimmed.length === 0 || trimmed.length > maxLength) {
			continue;
		}
		if (!result.includes(trimmed)) {
			result.push(trimmed);
		}
		if (result.length >= maxItems) {
			break;
		}
	}
	return result;
}

/**
 * 解析自定义词条：允许 `"word"` 或 `{ value, kind }` 两种写法。
 * @param value - 原始值
 */
function parseCustomWords(value: unknown): CustomWord[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const words: CustomWord[] = [];
	for (const item of value) {
		if (typeof item === "string") {
			const trimmed = item.trim();
			if (trimmed.length >= 2 && trimmed.length <= 256) {
				words.push({ value: trimmed });
			}
			continue;
		}
		if (typeof item !== "object" || item === null) {
			continue;
		}
		const record = item as Record<string, unknown>;
		const rawValue = typeof record["value"] === "string" ? record["value"].trim() : "";
		if (rawValue.length < 2 || rawValue.length > 256) {
			continue;
		}
		const rawKind = typeof record["kind"] === "string" ? record["kind"].toUpperCase() : "";
		const kind = (PRIVACY_KINDS as readonly string[]).includes(rawKind) ? (rawKind as PrivacyKind) : undefined;
		words.push(kind === undefined ? { value: rawValue } : { value: rawValue, kind: kind });
		if (words.length >= 200) {
			break;
		}
	}
	return words;
}

/**
 * 解析按类型的处置覆盖。
 * @param value - 原始值
 */
function parseKindActions(value: unknown): Partial<Record<PrivacyKind, PrivacyKindAction>> {
	const result: Partial<Record<PrivacyKind, PrivacyKindAction>> = {};
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return result;
	}
	for (const [rawKey, rawAction] of Object.entries(value as Record<string, unknown>)) {
		const kind = rawKey.toUpperCase();
		if (!(PRIVACY_KINDS as readonly string[]).includes(kind)) {
			continue;
		}
		if (rawAction === "mask" || rawAction === "warn" || rawAction === "off") {
			result[kind as PrivacyKind] = rawAction;
		}
	}
	return result;
}

/**
 * 把配置对象解析为生效配置。
 * @param raw - `litellm_settings.privacy_masking` 的内容
 */
export function parsePrivacyMaskingSettings(raw: unknown): PrivacyMaskingSettings {
	const record = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	const rawAction = record["action"];
	const action: "mask" | "warn" = rawAction === "warn" ? "warn" : "mask";
	const retention = Number(record["retention_days"]);
	const enabledFromEnv = process.env["PRIVACY_MASKING_ENABLED"];
	return {
		enabled:
			enabledFromEnv !== undefined && enabledFromEnv.trim().length > 0
				? parseBoolean(enabledFromEnv, DEFAULT_PRIVACY_MASKING_SETTINGS.enabled)
				: parseBoolean(record["enabled"], DEFAULT_PRIVACY_MASKING_SETTINGS.enabled),
		action: action,
		kinds: parseKindActions(record["kinds"]),
		neverMask: parseStringList(record["never_mask"], 200, 256),
		customWords: parseCustomWords(record["custom_words"]),
		maskConfiguredSecrets: parseBoolean(record["mask_configured_secrets"], true),
		failClosed: parseBoolean(record["fail_closed"], true),
		retentionDays: Number.isFinite(retention) && retention >= 1 && retention <= 365 ? Math.round(retention) : 30,
	};
}

/** 配置快照服务（带 TTL 与显式失效） */
class PrivacySettingsService {
	private _cached: PrivacyMaskingSettings | null = null;
	private _expiresAt = 0;

	/**
	 * 读取当前生效配置；TTL 内复用快照。
	 */
	async getSettings(): Promise<PrivacyMaskingSettings> {
		const now = Date.now();
		if (this._cached !== null && now < this._expiresAt) {
			return this._cached;
		}
		let settings = DEFAULT_PRIVACY_MASKING_SETTINGS;
		try {
			const litellmSettings = await dbConfigProvider.getEffectiveParam("litellm_settings");
			settings = parsePrivacyMaskingSettings(litellmSettings[PRIVACY_MASKING_CONFIG_KEY]);
		} catch {
			// 配置读取失败时保持默认值；脱敏默认开启，失败不应让请求绕过脱敏。
			settings = DEFAULT_PRIVACY_MASKING_SETTINGS;
		}
		this._cached = settings;
		this._expiresAt = now + SETTINGS_TTL_MS;
		return settings;
	}

	/**
	 * 失效快照（管理页保存后调用，下一次请求立即读到新配置）。
	 */
	invalidate(): void {
		this._cached = null;
		this._expiresAt = 0;
	}

	/**
	 * 直接覆盖快照（测试用）。
	 * @param settings - 生效配置
	 */
	setSnapshot(settings: PrivacyMaskingSettings): void {
		this._cached = settings;
		this._expiresAt = Date.now() + SETTINGS_TTL_MS;
	}
}

/** 进程级配置服务单例 */
export const privacySettingsService = new PrivacySettingsService();
