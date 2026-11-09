/** 占位符识别与展示文案（与后端 `src/privacy/PlaceholderCodec.ts` 的格式保持一致）。 */
export const PRIVACY_PLACEHOLDER_PATTERN = /\{\{([A-Z][A-Z0-9_]{1,23})_([a-z2-7]{8})\}\}/g;

/** 无状态版本（用于布尔判断，避免 `lastIndex` 干扰）。 */
const PRIVACY_PLACEHOLDER_TEST_PATTERN = /\{\{[A-Z][A-Z0-9_]{1,23}_[a-z2-7]{8}\}\}/;

/** 文本片段 */
export interface PrivacyTextSegment {
	/** 片段文本 */
	readonly text: string;
	/** 命中占位符时为类型 */
	readonly kind?: string;
}

/** 类型的中文名 */
const KIND_LABELS: Readonly<Record<string, string>> = {
	API_KEY: "服务密钥",
	SECRET: "机密串",
	JWT: "JWT 令牌",
	PEM: "私钥文件",
	PASSWORD: "口令",
	BEARER: "访问令牌",
	EMAIL: "邮箱",
	PHONE: "手机号",
	CN_ID: "身份证号",
	BANK_CARD: "银行卡号",
	SSN: "社保号",
	IBAN: "银行账号",
	USER: "用户名",
	CUSTOM: "自定义词条",
};

/**
 * 把文本切成普通片段与占位符片段，保持原顺序，不做任何字符替换。
 * @param text - 原始文本
 */
export function splitPrivacyPlaceholders(text: string): PrivacyTextSegment[] {
	if (!text.includes("{{")) {
		return [{ text: text }];
	}
	const segments: PrivacyTextSegment[] = [];
	let cursor = 0;
	const pattern = new RegExp(PRIVACY_PLACEHOLDER_PATTERN.source, "g");
	let match = pattern.exec(text);
	while (match !== null) {
		if (match.index > cursor) {
			segments.push({ text: text.slice(cursor, match.index) });
		}
		segments.push({ text: match[0], kind: match[1] });
		cursor = match.index + match[0].length;
		match = pattern.exec(text);
	}
	if (cursor < text.length) {
		segments.push({ text: text.slice(cursor) });
	}
	return segments;
}

/**
 * 文本里是否含占位符。
 * @param text - 原始文本
 */
export function containsPrivacyPlaceholder(text: string): boolean {
	return PRIVACY_PLACEHOLDER_TEST_PATTERN.test(text);
}

/**
 * 类型的中文名。
 * @param kind - 占位符里的类型
 */
export function privacyKindLabel(kind: string): string {
	return KIND_LABELS[kind] ?? kind;
}

/**
 * 占位符的提示文案（鼠标悬停与可访问名称共用）。
 * @param kind - 占位符里的类型
 */
export function privacyPlaceholderTitle(kind: string): string {
	return `${privacyKindLabel(kind)}已被网关脱敏；这是占位符，不是原文。`;
}
