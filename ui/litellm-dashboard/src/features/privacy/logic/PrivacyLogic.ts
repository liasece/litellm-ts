/** 脱敏页的展示派生逻辑（纯函数，便于测试）。 */
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import { privacyKindLabel } from "../../content/logic/PrivacyPlaceholderLogic";
import type { PrivacyBreakdownRow, PrivacyRequestRow, PrivacyRuleRow, PrivacyValueRow } from "../support/PrivacyModels";

/** 统计区间选项 */
export const PRIVACY_RANGE_OPTIONS: ReadonlyArray<{ readonly value: number; readonly label: string }> = [
	{ value: 7, label: "最近 7 天" },
	{ value: 30, label: "最近 30 天" },
];

/** 明细页签 */
export const PRIVACY_TABS: ReadonlyArray<{ readonly key: string; readonly label: string }> = [
	{ key: "requests", label: "按请求" },
	{ key: "values", label: "按值" },
];

/** 每页条数 */
export const PRIVACY_PAGE_SIZE = 50;

/** 类型对应的标签色 */
const KIND_TONES: Readonly<Record<string, string>> = {
	API_KEY: "red",
	SECRET: "red",
	PEM: "red",
	BEARER: "volcano",
	JWT: "volcano",
	PASSWORD: "orange",
	EMAIL: "blue",
	PHONE: "cyan",
	CN_ID: "purple",
	BANK_CARD: "purple",
	SSN: "purple",
	IBAN: "geekblue",
	USER: "gold",
	CUSTOM: "green",
};

/** 客户端的中文名 */
const CLIENT_LABELS: Readonly<Record<string, string>> = {
	claude_code: "Claude Code",
	codex: "Codex",
	antigravity: "Antigravity",
	pi: "Pi",
	other: "其它客户端",
};

/** 常见提供方的展示名 */
const PROVIDER_LABELS: Readonly<Record<string, string>> = {
	cliproxy: "CLIProxy",
	anthropic: "Anthropic",
	openai: "OpenAI",
	azure: "Azure OpenAI",
	gemini: "Google Gemini",
	vertex_ai: "Vertex AI",
	bedrock: "AWS Bedrock",
	deepseek: "DeepSeek",
	openrouter: "OpenRouter",
};

/**
 * 类型的标签色。
 * @param kind - 类型
 */
export function privacyKindTone(kind: string): string {
	return KIND_TONES[kind] ?? "default";
}

/**
 * 客户端展示名。
 * @param client - 客户端标识
 */
export function privacyClientLabel(client: string): string {
	return CLIENT_LABELS[client] ?? (client.length > 0 ? client : "未知客户端");
}

/**
 * 提供方展示名。
 * @param provider - 提供方标识
 */
export function privacyProviderLabel(provider: string): string {
	return PROVIDER_LABELS[provider] ?? (provider.length > 0 ? provider : "未知提供方");
}

/**
 * 数量的紧凑展示。
 * @param value - 数量
 */
export function privacyCount(value: number): string {
	if (value >= 1_000_000) return (value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1) + "M";
	if (value >= 10_000) return (value / 1_000).toFixed(value >= 100_000 ? 0 : 1) + "K";
	return formatNumberWithCommas(value);
}

/**
 * 占比文案。
 * @param value - 当前值
 * @param total - 总量
 */
export function privacyShare(value: number, total: number): string {
	if (total <= 0) return "0%";
	const percent = (value / total) * 100;
	return (percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)) + "%";
}

/**
 * 分组行的附加说明。
 * @param kind - 分组维度
 * @param row - 分组行
 */
export function privacyBreakdownNote(kind: "client" | "provider" | "kind", row: PrivacyBreakdownRow): string {
	if (kind === "kind") {
		return privacyCount(row.values ?? 0) + " 个不同的值";
	}
	return privacyCount(row.requests ?? 0) + " 个请求";
}

/**
 * 分组行的名称。
 * @param kind - 分组维度
 * @param name - 原始名称
 */
export function privacyBreakdownLabel(kind: "client" | "provider" | "kind", name: string): string {
	if (kind === "client") return privacyClientLabel(name);
	if (kind === "provider") return privacyProviderLabel(name);
	return privacyKindLabel(name);
}

/**
 * 请求行的类型摘要，例如「邮箱 3 · 手机号 1」。
 * @param kinds - 类型分布
 */
export function privacyKindsSummary(kinds: Readonly<Record<string, number>>): string {
	const entries = Object.entries(kinds).sort((a, b) => b[1] - a[1]);
	if (entries.length === 0) return "-";
	return entries.map(([kind, count]) => privacyKindLabel(kind) + " " + privacyCount(count)).join(" · ");
}

/**
 * 值行的提示文案：前 3 个字符 + 长度，不泄露原文。
 * @param row - 值行
 */
export function privacyValueHint(row: PrivacyValueRow): string {
	const hint = row.hint.length > 0 ? row.hint + "…" : "…";
	return hint + "（" + formatNumberWithCommas(row.length) + " 字符）";
}

/**
 * 时间展示（本地时区，精确到秒）。
 * @param iso - ISO 时间
 */
export function privacyTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return date.toLocaleString("zh-CN", { hour12: false });
}

/**
 * 请求行转成表格行。
 * @param row - 请求行
 */
export function privacyRequestTableRow(row: PrivacyRequestRow): Record<string, unknown> {
	return {
		id: row.requestId,
		created: privacyTime(row.createdAt),
		client: privacyClientLabel(row.client),
		provider: privacyProviderLabel(row.provider),
		model: row.model || "-",
		kinds: privacyKindsSummary(row.kinds),
		occurrences: privacyCount(row.occurrences),
		values: privacyCount(row.distinctValues),
		action: row.action === "warn" ? "仅记录" : "已替换",
	};
}

/**
 * 值行转成表格行。
 * @param row - 值行
 */
export function privacyValueTableRow(row: PrivacyValueRow): Record<string, unknown> {
	return {
		id: row.kind + ":" + row.hash,
		kind: privacyKindLabel(row.kind),
		hint: privacyValueHint(row),
		occurrences: privacyCount(row.occurrences),
		requests: privacyCount(row.requests),
		clients: row.clients.map((client) => privacyClientLabel(client)).join("、") || "-",
		lastSeen: privacyTime(row.lastSeen),
	};
}

/** 单个过滤特性的展示定义 */
export interface PrivacyFeature {
	/** 类型标识（与后端 `{{PRIVACY_KINDS}}` 一致） */
	readonly kind: string;
	/** 一句话说明命中的是什么 */
	readonly description: string;
}

/** 过滤特性分组 */
export interface PrivacyFeatureGroup {
	/** 分组标题 */
	readonly title: string;
	/** 分组说明 */
	readonly note: string;
	/** 组内特性 */
	readonly features: readonly PrivacyFeature[];
}

/** 单项处置选项：替换为占位符 / 只统计 / 拒绝请求 / 完全关闭 */
export const PRIVACY_KIND_ACTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
	{ value: "mask", label: "替换" },
	{ value: "warn", label: "仅统计" },
	{ value: "block", label: "拒绝请求" },
	{ value: "off", label: "关闭" },
];

/** 全部可开关的过滤特性 */
export const PRIVACY_FEATURE_GROUPS: readonly PrivacyFeatureGroup[] = [
	{
		title: "个人信息",
		note: "发给上游之前替换成占位符，回到客户端再还原",
		features: [
			{ kind: "EMAIL", description: "邮箱地址" },
			{ kind: "PHONE", description: "中国大陆手机号" },
			{ kind: "CN_ID", description: "身份证号（校验位通过才命中）" },
			{ kind: "BANK_CARD", description: "银行卡号（Luhn 通过才命中）" },
			{ kind: "SSN", description: "美国社保号" },
			{ kind: "IBAN", description: "国际银行账号" },
			{ kind: "USER", description: "家目录路径里的用户名" },
		],
	},
	{
		title: "凭据与密钥",
		note: "常见供应商密钥格式、赋值式凭据与私钥整段",
		features: [
			{ kind: "API_KEY", description: "OpenAI / Anthropic / Stripe 等密钥" },
			{ kind: "SECRET", description: "TOKEN / SECRET / PASSWORD 赋值右侧的字面量" },
			{ kind: "PASSWORD", description: "URL 里内嵌的口令" },
			{ kind: "BEARER", description: "Authorization: Bearer 后面的令牌" },
			{ kind: "JWT", description: "JWT 令牌" },
			{ kind: "PEM", description: "PEM 私钥整段" },
		],
	},
	{
		title: "自定义",
		note: "管理员维护的词条，命中后按指定类型替换",
		features: [{ kind: "CUSTOM", description: "管理员维护的敏感词，命中后按自定义类型替换" }],
	},
];

/**
 * 读取某个类型的处置，缺省为「替换」。
 * @param kinds - 配置里的按类型处置
 * @param kind - 类型标识
 */
export function privacyKindAction(kinds: Readonly<Record<string, string>>, kind: string): string {
	return kinds[kind] ?? "mask";
}

/**
 * 生成新的按类型处置表；与缺省值相同的项不写入，避免配置里堆积默认值。
 * @param kinds - 当前配置
 * @param kind - 类型标识
 * @param action - 目标处置
 */
export function privacyKindsWithAction(kinds: Readonly<Record<string, string>>, kind: string, action: string): Record<string, string> {
	const next: Record<string, string> = {};
	for (const [key, value] of Object.entries(kinds)) {
		if (key !== kind) {
			next[key] = value;
		}
	}
	if (action !== "mask") {
		next[kind] = action;
	}
	return next;
}

/**
 * 已关闭或仅统计的特性数量，用于面板摘要。
 * @param kinds - 配置里的按类型处置
 */
export function privacyDisabledFeatureCount(kinds: Readonly<Record<string, string>>): number {
	return Object.values(kinds).filter((action) => action === "off" || action === "warn").length;
}

/**
 * 被设为「拒绝请求」的类型数量，用于面板摘要。
 * @param kinds - 配置里的按类型处置
 */
export function privacyBlockedFeatureCount(kinds: Readonly<Record<string, string>>): number {
	return Object.values(kinds).filter((action) => action === "block").length;
}

/** 全局处置选项 */
export const PRIVACY_ACTION_OPTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
	{ value: "mask", label: "替换" },
	{ value: "warn", label: "仅统计" },
];

/** 统计保留天数选项 */
export const PRIVACY_RETENTION_OPTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
	{ value: "7", label: "7 天" },
	{ value: "30", label: "30 天" },
	{ value: "90", label: "90 天" },
	{ value: "365", label: "365 天" },
];

/** 自定义词条与白名单的条数上限（与后端一致） */
export const PRIVACY_WORD_LIMIT = 200;

/** 词条长度范围：自定义词条 2-256，白名单 1-256 */
export const PRIVACY_WORD_LENGTHS = { custom: 2, allowlist: 1, max: 256 } as const;

/**
 * 把配置里的词条归一化成字符串列表：兼容 `"值"` 与 `{ value, kind }` 两种写法。
 * @param words - 配置里的词条
 */
export function privacyWordValues(words: ReadonlyArray<string | { readonly value: string }>): string[] {
	const values: string[] = [];
	for (const word of words) {
		const value = typeof word === "string" ? word.trim() : word.value.trim();
		if (value.length > 0) {
			values.push(value);
		}
	}
	return values;
}

/**
 * 追加一个词条；空白、重复（忽略大小写）、长度越界或已达上限时返回原列表。
 * @param words - 当前词条
 * @param value - 待追加的词条
 * @param minLength - 最短长度
 */
export function privacyWordsWithAdded(words: readonly string[], value: string, minLength: number): readonly string[] {
	const trimmed = value.trim();
	if (trimmed.length < minLength || trimmed.length > PRIVACY_WORD_LENGTHS.max || words.length >= PRIVACY_WORD_LIMIT) {
		return words;
	}
	const lower = trimmed.toLowerCase();
	if (words.some((word) => word.toLowerCase() === lower)) {
		return words;
	}
	return [...words, trimmed];
}

/**
 * 移除一个词条（忽略大小写）；不存在时返回原列表。
 * @param words - 当前词条
 * @param value - 待移除的词条
 */
export function privacyWordsWithout(words: readonly string[], value: string): readonly string[] {
	const lower = value.trim().toLowerCase();
	const next = words.filter((word) => word.toLowerCase() !== lower);
	return next.length === words.length ? words : next;
}

/** 用户规则的匹配方式 */
export type PrivacyRuleMode = "prefix" | "regex";

/** 类型名合法形态，与后端校验保持一致 */
export const PRIVACY_RULE_KIND_PATTERN = /^[A-Z][A-Z0-9_]{0,23}$/;

/** 规则条数上限 */
export const PRIVACY_RULE_MAX = 50;

/** 规则表达式的最大长度 */
export const PRIVACY_RULE_EXPRESSION_MAX = 200;

/** 规则匹配方式选项 */
export const PRIVACY_RULE_MODES: ReadonlyArray<{ readonly value: PrivacyRuleMode; readonly label: string }> = [
	{ value: "prefix", label: "前缀" },
	{ value: "regex", label: "正则" },
];

/**
 * 规则的唯一标识（用于删除与去重）。
 * @param rule - 规则
 */
export function privacyRuleSignature(rule: PrivacyRuleRow): string {
	return `${rule.kind}\u0000${rule.prefix ?? ""}\u0000${rule.regex ?? ""}`;
}

/**
 * 规则的展示文案：`TICKET · ACME-` 或 `ORG_ID · /org_[a-z0-9]{12}/`。
 * @param rule - 规则
 */
export function privacyRuleLabel(rule: PrivacyRuleRow): string {
	if (rule.prefix !== undefined && rule.prefix.length > 0) {
		return `${rule.kind} · ${rule.prefix}`;
	}
	return `${rule.kind} · /${rule.regex ?? ""}/`;
}

/**
 * 校验并构造一条规则；不合法时返回 null（页面据此禁用「添加」）。
 * @param kind - 类型名
 * @param mode - 匹配方式
 * @param expression - 前缀或正则
 */
export function privacyRuleFrom(kind: string, mode: PrivacyRuleMode, expression: string): PrivacyRuleRow | null {
	const normalizedKind = kind.trim().toUpperCase();
	const value = expression.trim();
	if (!PRIVACY_RULE_KIND_PATTERN.test(normalizedKind)) {
		return null;
	}
	if (value.length === 0 || value.length > PRIVACY_RULE_EXPRESSION_MAX) {
		return null;
	}
	if (mode === "prefix") {
		if (value.length > 64) {
			return null;
		}
		return { kind: normalizedKind, prefix: value };
	}
	try {
		new RegExp(value, "gd");
	} catch {
		return null;
	}
	return { kind: normalizedKind, regex: value };
}

/**
 * 追加一条规则；重复或已达上限时返回原数组。
 * @param rules - 现有规则
 * @param rule - 新规则
 */
export function privacyRulesWithAdded(rules: readonly PrivacyRuleRow[], rule: PrivacyRuleRow): readonly PrivacyRuleRow[] {
	if (rules.length >= PRIVACY_RULE_MAX) {
		return rules;
	}
	const signature = privacyRuleSignature(rule);
	if (rules.some((item) => privacyRuleSignature(item) === signature)) {
		return rules;
	}
	return [...rules, rule];
}

/**
 * 删除一条规则；不存在时返回原数组。
 * @param rules - 现有规则
 * @param signature - 规则标识
 */
export function privacyRulesWithout(rules: readonly PrivacyRuleRow[], signature: string): readonly PrivacyRuleRow[] {
	const next = rules.filter((item) => privacyRuleSignature(item) !== signature);
	return next.length === rules.length ? rules : next;
}

/** 生效范围单条的最大长度与总条数，与后端校验保持一致 */
export const PRIVACY_SCOPE_CONSTRAINTS = { maxLength: 64, maxCount: 50 } as const;

/**
 * 追加一条生效范围（提供方或模型）；空白、重复、越界或已达上限时返回原数组。
 * @param entries - 当前列表
 * @param value - 待追加的条目
 */
export function privacyScopeWithAdded(entries: readonly string[], value: string): readonly string[] {
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > PRIVACY_SCOPE_CONSTRAINTS.maxLength) {
		return entries;
	}
	if (entries.length >= PRIVACY_SCOPE_CONSTRAINTS.maxCount) {
		return entries;
	}
	const lower = trimmed.toLowerCase();
	if (entries.some((entry) => entry.toLowerCase() === lower)) {
		return entries;
	}
	return [...entries, trimmed];
}

/**
 * 移除一条生效范围（忽略大小写）；不存在时返回原数组。
 * @param entries - 当前列表
 * @param value - 待移除的条目
 */
export function privacyScopeWithout(entries: readonly string[], value: string): readonly string[] {
	const lower = value.trim().toLowerCase();
	const next = entries.filter((entry) => entry.toLowerCase() !== lower);
	return next.length === entries.length ? entries : next;
}

/**
 * 生效范围的展示文案：提供方与模型都为空时说明对所有流量生效。
 * @param providers - 生效提供方
 * @param models - 生效模型
 */
export function privacyScopeSummary(providers: readonly string[], models: readonly string[]): string {
	const parts: string[] = [];
	if (providers.length > 0) parts.push(`提供方 ${providers.join("、")}`);
	if (models.length > 0) parts.push(`模型 ${models.join("、")}`);
	return parts.length > 0 ? `当前只对${parts.join("，")} 生效` : "当前对所有提供方与模型生效";
}
