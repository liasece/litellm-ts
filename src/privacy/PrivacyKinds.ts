/**
 * 可逆脱敏的敏感类型与处置动作。
 *
 * 类型同时出现在占位符（`{{KIND_hash8}}`）与统计接口里，因此使用稳定的英文标识，
 * 展示文案由 Dashboard 决定。新增类型只能追加，不能改名——占位符会随请求离开本机，
 * 改名会让历史占位符无法被识别。
 */

/** 全部可识别的脱敏类型 */
export const PRIVACY_KINDS = [
	"API_KEY",
	"SECRET",
	"JWT",
	"PEM",
	"PASSWORD",
	"BEARER",
	"EMAIL",
	"PHONE",
	"CN_ID",
	"BANK_CARD",
	"SSN",
	"IBAN",
	"USER",
	"CUSTOM",
] as const;

/** 内置敏感类型 */
export type PrivacyKind = (typeof PRIVACY_KINDS)[number];

/**
 * 生效的类型名：内置类型，或用户规则声明的自定义类型（大写字母、数字与下划线）。
 * 类型名会写进占位符，因此只允许占位符能安全承载的字符集。
 */
export type PrivacyKindName = string;

/** 类型名合法形态：大写字母开头，后续大写字母、数字或下划线，最长 24 个字符 */
export const PRIVACY_KIND_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,23}$/;

/**
 * 开启「同形态假值」时改用假值替换的类型。
 *
 * 只用于上游或下游会校验值形态的凭据类：占位符在这些位置会被判成格式错误，
 * 假值保留长度与字符类别，读起来仍然是「一把 key」。邮箱、证件号等仍用占位符。
 */
export const PRIVACY_SHAPED_KINDS: ReadonlySet<string> = new Set(["API_KEY", "SECRET", "JWT", "BEARER"]);

/** 命中来源：内置规则、管理员配置的词典、网关自身配置的凭据 */
export type PrivacySource = "rule" | "dictionary" | "configured_secret";

/**
 * 单个类型允许的处置：
 * - mask 替换为占位符；
 * - warn 只统计不替换；
 * - off 完全不识别也不计数；
 * - block 照常替换，同时拒绝整条请求（宁可挡住也不让原文上行）。
 */
export type PrivacyKindAction = "mask" | "warn" | "off" | "block";

/** 请求级处置：mask 与 warn 的聚合结果，block 表示请求已被拒绝 */
export type PrivacyAction = "mask" | "warn" | "block";

/** 一次命中的脱敏记录（仅存在于进程内，不落库） */
export interface PrivacyHit {
	/** 敏感类型；内置类型或用户规则声明的自定义类型 */
	readonly kind: PrivacyKindName;
	/** 原始值（只在本请求内存中保留，用于还原） */
	readonly value: string;
	/** 命中来源 */
	readonly source: PrivacySource;
	/** 生成该命中的规则或词条 ID */
	readonly rule: string;
}

/** 请求级脱敏上下文对外暴露的统计快照 */
export interface PrivacyContextStats {
	/** 实际替换的处数 */
	readonly occurrences: number;
	/** 不同值的数量 */
	readonly distinctValues: number;
	/** 各类型的处数 */
	readonly kinds: Readonly<Record<string, number>>;
	/** 响应中无法还原的占位符数量 */
	readonly unresolved: number;
	/** 本次请求的处置 */
	readonly action: PrivacyAction;
	/** 脱敏耗时（毫秒） */
	readonly durationMs: number;
}
