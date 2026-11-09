/**
 * 文本扫描器：把一段文本切成「原样保留」与「需要脱敏」两类区间。
 *
 * 命中来源有三类，优先级从高到低：
 * 1. 配置的凭据（网关自身的 provider key 等）——最不该泄漏，长度也最长；
 * 2. 管理员维护的自定义词条；
 * 3. 内置规则（密钥格式、邮箱、证件号、家目录用户名等）。
 *
 * 已经生成过的占位符本身不会被再次识别：扫描前先记录占位符区间并跳过，
 * 保证脱敏是幂等的（同一段文本二次处理不会产生嵌套占位符）。
 */
import { PLACEHOLDER_PATTERN } from "./PlaceholderCodec";
import { PRIVACY_RULES, compileRulePattern, type PrivacyRule } from "./DetectionRules";
import type { PrivacyHit, PrivacyKindName, PrivacySource } from "./PrivacyKinds";

/** 扫描出的一段命中 */
export interface ScanHit extends PrivacyHit {
	/** 命中在文本中的起始下标 */
	readonly start: number;
	/** 命中在文本中的结束下标（不含） */
	readonly end: number;
}

/** 自定义词条 */
export interface CustomWord {
	/** 词条原文 */
	readonly value: string;
	/** 命中的类型，缺省为 CUSTOM */
	readonly kind?: PrivacyKindName;
}

/**
 * 管理员配置的规则：前缀或正则之一，命中后按 `kind` 类型替换。
 * 规则在读取配置时编译并校验，扫描路径只管执行。
 */
export interface PrivacyUserRule {
	/** 命中后写入占位符的类型名 */
	readonly kind: PrivacyKindName;
	/** 字面前缀：从该前缀开始向后吃掉连续的 token 字符 */
	readonly prefix?: string;
	/** 正则（第一组捕获或整个匹配作为值） */
	readonly regex?: string;
}

/** 编译后的用户规则 */
interface CompiledUserRule {
	/** 类型名 */
	readonly kind: PrivacyKindName;
	/** 执行用正则（每次扫描需要新实例） */
	readonly source: string;
	/** 正则标志 */
	readonly flags: string;
	/** 规则标识（统计与诊断用） */
	readonly id: string;
}

/** 扫描选项 */
export interface ScanOptions {
	/** 关闭的类型 */
	readonly disabledKinds: ReadonlySet<string>;
	/** 管理员维护的自定义词条 */
	readonly customWords: readonly CustomWord[];
	/** 网关自身配置的凭据（精确匹配） */
	readonly configuredSecrets: readonly string[];
	/** 永不脱敏的字面量 */
	readonly allowlist: readonly string[];
	/** 管理员配置的前缀 / 正则规则 */
	readonly rules?: readonly PrivacyUserRule[];
}

/** 前缀规则向后吃掉的最大字符数 */
const MAX_PREFIX_VALUE_LENGTH = 128;

/** 前缀规则参与匹配的字符（凭据与 token 常见字符集） */
const PREFIX_VALUE_CHARS = "A-Za-z0-9._~+/=:-";

/**
 * 编译用户规则；无效规则（正则可编译失败、前缀过短）直接跳过。
 * @param rules - 配置里的用户规则
 */
function compileUserRules(rules: readonly PrivacyUserRule[]): CompiledUserRule[] {
	const compiled: CompiledUserRule[] = [];
	for (const rule of rules) {
		const kind = rule.kind.trim().toUpperCase();
		if (/^[A-Z][A-Z0-9_]{0,23}$/.test(kind) === false) {
			continue;
		}
		const prefix = rule.prefix?.trim() ?? "";
		const regex = rule.regex?.trim() ?? "";
		if (prefix.length > 0) {
			const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			compiled.push({
				kind: kind,
				source: escaped + "[" + PREFIX_VALUE_CHARS + "]{0," + MAX_PREFIX_VALUE_LENGTH + "}",
				flags: "gd",
				id: "user-prefix:" + kind,
			});
			continue;
		}
		if (regex.length === 0) {
			continue;
		}
		try {
			new RegExp(regex, "g");
		} catch {
			continue;
		}
		compiled.push({ kind: kind, source: regex, flags: "gd", id: "user-regex:" + kind });
	}
	return compiled;
}

/**
 * 执行用户规则，返回命中列表（未做去重，交给 mergeHits）。
 * @param text - 待扫描文本
 * @param rules - 编译后的规则
 * @param disabledKinds - 关闭的类型
 * @param allowlist - 白名单
 * @param spans - 占位符区间
 */
function scanUserRules(
	text: string,
	rules: readonly CompiledUserRule[],
	disabledKinds: ReadonlySet<string>,
	allowlist: ReadonlySet<string>,
	spans: readonly { start: number; end: number }[],
): ScanHit[] {
	const hits: ScanHit[] = [];
	for (const rule of rules) {
		if (disabledKinds.has(rule.kind)) {
			continue;
		}
		const regex = new RegExp(rule.source, rule.flags);
		let match = regex.exec(text);
		while (match !== null) {
			const group = match[1] !== undefined && match[1].length > 0 ? 1 : 0;
			const indices = match.indices?.[group];
			const value = group === 1 ? (match[1] ?? "") : match[0];
			if (indices !== undefined && value.length > 0) {
				const [start, end] = indices;
				if (!isAllowlisted(value, allowlist) && !overlaps(start, end, spans)) {
					hits.push({ kind: rule.kind, value: value, rule: rule.id, source: "rule", start: start, end: end });
				}
			}
			if (match[0].length === 0) {
				regex.lastIndex++;
			}
			match = regex.exec(text);
		}
	}
	return hits;
}

/** 内置规则的编译缓存（`g`/`d` 正则每次扫描仍需新实例） */
const RULE_PATTERNS: readonly { readonly rule: PrivacyRule; readonly regex: RegExp }[] = PRIVACY_RULES.map((rule) => ({
	rule: rule,
	regex: compileRulePattern(rule),
}));

/**
 * 找出文本中所有占位符区间，供幂等性判断使用。
 * @param text - 待扫描文本
 */
function placeholderSpans(text: string): Array<{ start: number; end: number }> {
	const spans: Array<{ start: number; end: number }> = [];
	const pattern = new RegExp(PLACEHOLDER_PATTERN.source, "g");
	let match = pattern.exec(text);
	while (match !== null) {
		spans.push({ start: match.index, end: match.index + match[0].length });
		match = pattern.exec(text);
	}
	return spans;
}

/**
 * 判断区间是否与任意保留区间重叠。
 * @param start - 起始下标
 * @param end - 结束下标
 * @param spans - 保留区间
 */
function overlaps(start: number, end: number, spans: readonly { start: number; end: number }[]): boolean {
	for (const span of spans) {
		if (span.start < end && span.end > start) {
			return true;
		}
	}
	return false;
}

/**
 * 判断匹配值是否应当被允许（示例域名、白名单、占位符形态）。
 * @param value - 匹配到的文本
 * @param allowlist - 永不脱敏的字面量集合
 */
function isAllowlisted(value: string, allowlist: ReadonlySet<string>): boolean {
	if (allowlist.has(value)) {
		return true;
	}
	if (value.startsWith("{{") && value.endsWith("}}")) {
		return true;
	}
	return false;
}

/**
 * 扫描一段文本，返回按位置排序且互不重叠的命中。
 * @param text - 待扫描文本
 * @param options - 扫描选项
 */
export function scanText(text: string, options: ScanOptions): ScanHit[] {
	if (text.length < 4) {
		return [];
	}
	const allowlist = new Set(options.allowlist);
	const spans = placeholderSpans(text);
	const hits: ScanHit[] = [];

	for (const entry of RULE_PATTERNS) {
		const rule = entry.rule;
		if (options.disabledKinds.has(rule.kind)) {
			continue;
		}
		if (!rule.prefilter.some((marker) => text.includes(marker))) {
			continue;
		}
		const regex = new RegExp(entry.regex.source, entry.regex.flags);
		let match = regex.exec(text);
		while (match !== null) {
			if (match[0].length === 0) {
				regex.lastIndex++;
				match = regex.exec(text);
				continue;
			}
			const group = rule.group ?? 0;
			const indices = match.indices?.[group];
			if (indices !== undefined) {
				const [start, end] = indices;
				const value = text.slice(start, end);
				// 前一个字符是引号时，说明命中值来自字符串字面量而不是代码里的引用。
				const quoted = start > 0 && (text[start - 1] === '"' || text[start - 1] === "'" || text[start - 1] === "`");
				const accepted = acceptRuleMatch(
					{ rule: rule, value: value, text: text, start: start, quoted: quoted },
					allowlist,
					spans,
				);
				if (accepted) {
					hits.push({ kind: rule.kind, value: value, rule: rule.id, source: "rule", start: start, end: end });
				}
			}
			match = regex.exec(text);
		}
	}

	if (options.rules !== undefined && options.rules.length > 0) {
		const compiled = compileUserRules(options.rules);
		for (const hit of scanUserRules(text, compiled, options.disabledKinds, allowlist, spans)) {
			if (!overlaps(hit.start, hit.end, hits)) {
				hits.push(hit);
			}
		}
	}

	for (const word of options.customWords) {
		const value = word.value;
		if (value.length < 2 || isAllowlisted(value, allowlist)) {
			continue;
		}
		const kind = word.kind ?? "CUSTOM";
		if (options.disabledKinds.has(kind)) {
			continue;
		}
		let index = text.indexOf(value);
		while (index >= 0) {
			const end = index + value.length;
			if (!overlaps(index, end, spans) && !overlaps(index, end, hits)) {
				hits.push({ kind: kind, value: value, rule: "custom-word", source: "dictionary", start: index, end: end });
			}
			index = text.indexOf(value, index + value.length);
		}
	}

	for (const secret of options.configuredSecrets) {
		if (secret.length < 12 || isAllowlisted(secret, allowlist)) {
			continue;
		}
		let index = text.indexOf(secret);
		while (index >= 0) {
			const end = index + secret.length;
			if (!overlaps(index, end, spans) && !overlaps(index, end, hits)) {
				hits.push({
					kind: "SECRET",
					value: secret,
					rule: "configured-secret",
					source: "configured_secret",
					start: index,
					end: end,
				});
			}
			index = text.indexOf(secret, index + secret.length);
		}
	}

	return mergeHits(hits);
}

/** 规则命中候选 */
interface RuleCandidate {
	/** 规则定义 */
	readonly rule: PrivacyRule;
	/** 捕获到的值 */
	readonly value: string;
	/** 完整文本 */
	readonly text: string;
	/** 命中起始下标 */
	readonly start: number;
	/** 命中值是否被引号包住（字符串字面量） */
	readonly quoted: boolean;
}

/**
 * 校验单条规则命中是否成立。
 * @param candidate - 命中候选
 * @param allowlist - 白名单集合
 * @param spans - 占位符区间
 */
function acceptRuleMatch(
	candidate: RuleCandidate,
	allowlist: ReadonlySet<string>,
	spans: readonly { start: number; end: number }[],
): boolean {
	const rule = candidate.rule;
	const value = candidate.value;
	const text = candidate.text;
	const start = candidate.start;
	if (value.length === 0 || isAllowlisted(value, allowlist)) {
		return false;
	}
	if (rule.minLength !== undefined && value.length < rule.minLength) {
		return false;
	}
	if (overlaps(start, start + value.length, spans)) {
		return false;
	}
	if (rule.context !== undefined || rule.selfPrefix !== undefined) {
		const contextWindow = text.slice(Math.max(0, start - 32), start);
		const contextOk = rule.context !== undefined && rule.context.test(contextWindow);
		const prefixOk = rule.selfPrefix !== undefined && rule.selfPrefix.test(text.slice(start, start + 6));
		if (!contextOk && !prefixOk) {
			return false;
		}
	}
	if (rule.exclusion !== undefined) {
		const exclusionWindow = text.slice(Math.max(0, start - 96), start);
		if (rule.exclusion.test(exclusionWindow)) {
			return false;
		}
	}
	if (rule.validate !== undefined && !rule.validate(value, { quoted: candidate.quoted })) {
		return false;
	}
	return true;
}

/**
 * 去重叠并按位置排序：同一起点保留更长的命中，后到的重叠命中丢弃。
 * @param hits - 原始命中列表
 */
function mergeHits(hits: ScanHit[]): ScanHit[] {
	if (hits.length <= 1) {
		return hits;
	}
	const sorted = [...hits].sort((left, right) => left.start - right.start || right.end - left.end);
	const merged: ScanHit[] = [];
	let cursor = -1;
	for (const hit of sorted) {
		if (hit.start >= cursor) {
			merged.push(hit);
			cursor = hit.end;
		}
	}
	return merged;
}

/**
 * 计算命中来源集合，供统计与诊断使用。
 * @param hits - 命中列表
 */
export function hitSources(hits: readonly ScanHit[]): PrivacySource[] {
	return [...new Set(hits.map((hit) => hit.source))];
}
