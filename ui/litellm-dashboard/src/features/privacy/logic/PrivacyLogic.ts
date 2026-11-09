/** 脱敏页的展示派生逻辑（纯函数，便于测试）。 */
import { formatNumberWithCommas } from "../../formatting/logic/NumberFormattingLogic";
import { privacyKindLabel } from "../../content/logic/PrivacyPlaceholderLogic";
import type { PrivacyBreakdownRow, PrivacyRequestRow, PrivacyValueRow } from "../support/PrivacyModels";

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
 * 占比条的宽度（0-100）。
 * @param value - 当前值
 * @param total - 总量
 */
export function privacyShareWidth(value: number, total: number): number {
	if (value <= 0 || total <= 0) return 0;
	return Math.max(2, Math.min(100, Math.round((value / total) * 100)));
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
