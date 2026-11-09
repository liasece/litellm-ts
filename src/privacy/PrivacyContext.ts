/**
 * 单次请求的脱敏上下文。
 *
 * 一个上下文只服务一个请求，保存：
 * - 值 → 占位符的映射（用于替换同一请求中后续出现的位置，包括工具参数与多轮历史）；
 * - 占位符 → 原文的映射（响应还原只依赖它，进程外没有任何原文副本）；
 * - 命中统计（请求级汇总与值级指纹，写库时只用这些派生信息）。
 *
 * 同一值在请求内只生成一个占位符，跨请求也稳定（HMAC 决定），因此多轮对话里
 * 前缀字节不变，供应商的 prompt cache 不会因为脱敏而失效。
 */
import { isPlaceholderToken, placeholderCodec } from "./PlaceholderCodec";
import { scanText, type CustomWord, type ScanHit } from "./Detector";
import type { PrivacyContextStats, PrivacyKind, PrivacyKindAction } from "./PrivacyKinds";
import type { PrivacyMaskingSettings } from "./PrivacyConfig";

/** 单段文本允许执行规则扫描的最大长度；更长的文本只做已知值替换 */
const MAX_SCAN_LENGTH = 512_000;

/** 参与「同请求内传播」的值的最小长度（太短的值做字面量替换会误伤） */
const MIN_PROPAGATE_LENGTH = 6;

/** 同请求内传播的值的数量上限，避免组合正则过长 */
const MAX_PROPAGATE_VALUES = 64;

/** 上下文构造参数 */
export interface PrivacyContextInit {
	/** 生效配置 */
	readonly settings: PrivacyMaskingSettings;
	/** 管理员维护的自定义词条 */
	readonly customWords: readonly CustomWord[];
	/** 网关自身配置的凭据 */
	readonly configuredSecrets: readonly string[];
}

/** 一次值级统计（不包含原文） */
export interface PrivacyValueStat {
	/** 敏感类型 */
	readonly kind: PrivacyKind;
	/** 占位符里的 8 位指纹 */
	readonly hash: string;
	/** 原文长度 */
	readonly length: number;
	/** 前 3 个字符（用于人工区分，不足以还原） */
	readonly hint: string;
	/** 请求内的出现次数 */
	readonly occurrences: number;
}

/** 内部：一个已登记的值 */
interface RegisteredValue {
	/** 敏感类型 */
	readonly kind: PrivacyKind;
	/** 对应占位符 */
	readonly token: string;
	/** 出现次数 */
	occurrences: number;
}

/**
 * 转义正则元字符。
 * @param value - 原始字面量
 */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 请求级脱敏上下文 */
export class PrivacyContext {
	private readonly _settings: PrivacyMaskingSettings;
	private readonly _customWords: readonly CustomWord[];
	private readonly _configuredSecrets: readonly string[];
	private readonly _values = new Map<string, RegisteredValue>();
	private readonly _tokens = new Map<string, string>();
	private readonly _kindCounts = new Map<string, number>();
	private _knownPattern: RegExp | null = null;
	private _knownPatternVersion = -1;
	private _valueVersion = 0;
	private _occurrences = 0;
	private _unresolved = 0;
	private _replaced = false;
	private _startedAt = Date.now();

	/**
	 * @param init - 上下文初始化参数
	 */
	constructor(init: PrivacyContextInit) {
		this._settings = init.settings;
		this._customWords = init.customWords;
		this._configuredSecrets = init.configuredSecrets;
	}

	/** 占位符到原文的映射（响应还原使用） */
	get tokenMap(): ReadonlyMap<string, string> {
		return this._tokens;
	}

	/** 是否产生过替换（决定是否需要包装响应写入） */
	get hasReplacements(): boolean {
		return this._replaced;
	}

	/** 生效配置 */
	get settings(): PrivacyMaskingSettings {
		return this._settings;
	}

	/**
	 * 记录一次无法还原的占位符。
	 */
	noteUnresolved(): void {
		this._unresolved++;
	}

	/**
	 * 计算某个类型当前的处置动作。
	 * @param kind - 敏感类型
	 */
	actionFor(kind: PrivacyKind): PrivacyKindAction {
		const override = this._settings.kinds[kind];
		if (override !== undefined) {
			return override;
		}
		return this._settings.action;
	}

	/**
	 * 脱敏一段纯文本。
	 * @param text - 原始文本
	 */
	maskText(text: string): string {
		if (text.length < 4) {
			return text;
		}
		let current = text;
		if (this._values.size > 0 && current.length <= MAX_SCAN_LENGTH) {
			current = this._propagateKnownValues(current);
		}
		if (current.length > MAX_SCAN_LENGTH) {
			return current;
		}
		const hits = scanText(current, {
			disabledKinds: this._disabledKinds(),
			customWords: this._customWords,
			configuredSecrets: this._settings.maskConfiguredSecrets ? this._configuredSecrets : [],
			allowlist: this._settings.neverMask,
		});
		if (hits.length === 0) {
			return current;
		}
		return this._applyHits(current, hits);
	}

	/**
	 * 脱敏一段 JSON 文本（工具调用参数、注入的结构化字段等）。
	 * 解析失败时退化为普通文本脱敏。
	 * @param text - JSON 文本
	 */
	maskJsonText(text: string): string {
		if (text.length < 4) {
			return text;
		}
		try {
			const parsed: unknown = JSON.parse(text);
			const masked = this.maskValue(parsed);
			return JSON.stringify(masked);
		} catch {
			return this.maskText(text);
		}
	}

	/**
	 * 递归脱敏任意 JSON 值（字符串叶子节点）。
	 * @param value - 原始值
	 */
	maskValue(value: unknown): unknown {
		if (typeof value === "string") {
			return this.maskText(value);
		}
		if (Array.isArray(value)) {
			return value.map((item) => this.maskValue(item));
		}
		if (typeof value === "object" && value !== null) {
			const source = value as Record<string, unknown>;
			const result: Record<string, unknown> = {};
			for (const [key, item] of Object.entries(source)) {
				result[key] = this.maskValue(item);
			}
			return result;
		}
		return value;
	}

	/**
	 * 就地脱敏一个普通对象（用于已解析的请求体子树，避免整棵树复制）。
	 * @param value - 原始值
	 */
	maskInPlace(value: unknown): unknown {
		if (typeof value === "string") {
			return this.maskText(value);
		}
		if (Array.isArray(value)) {
			for (let index = 0; index < value.length; index++) {
				value[index] = this.maskInPlace(value[index]);
			}
			return value;
		}
		if (typeof value === "object" && value !== null) {
			const record = value as Record<string, unknown>;
			for (const key of Object.keys(record)) {
				record[key] = this.maskInPlace(record[key]);
			}
			return value;
		}
		return value;
	}

	/**
	 * 输出统计快照（写库与接口使用）。
	 */
	snapshotStats(): PrivacyContextStats {
		const kinds: Record<string, number> = {};
		for (const [kind, count] of this._kindCounts) {
			kinds[kind] = count;
		}
		return {
			occurrences: this._occurrences,
			distinctValues: this._values.size,
			kinds: kinds,
			unresolved: this._unresolved,
			action: this._settings.action === "warn" || !this._replaced ? "warn" : "mask",
			durationMs: Date.now() - this._startedAt,
		};
	}

	/**
	 * 输出值级统计（只含指纹、长度、前 3 个字符）。
	 */
	valueStats(): PrivacyValueStat[] {
		const result: PrivacyValueStat[] = [];
		for (const [value, entry] of this._values) {
			result.push({
				kind: entry.kind,
				hash: placeholderCodec.hash(entry.kind, value),
				length: value.length,
				hint: value.slice(0, 3),
				occurrences: entry.occurrences,
			});
		}
		return result;
	}

	/**
	 * 重置计时（响应结束时统计耗时口径为整个请求）。
	 */
	resetTimer(): void {
		this._startedAt = Date.now();
	}

	/**
	 * 关闭的类型集合。
	 */
	private _disabledKinds(): ReadonlySet<string> {
		const disabled = new Set<string>();
		for (const [kind, action] of Object.entries(this._settings.kinds)) {
			if (action === "off") {
				disabled.add(kind);
			}
		}
		return disabled;
	}

	/**
	 * 用已登记的值做字面量替换（同一请求内传播）。
	 * @param text - 原始文本
	 */
	private _propagateKnownValues(text: string): string {
		const pattern = this._knownValuesPattern();
		if (pattern === null) {
			return text;
		}
		const regex = new RegExp(pattern.source, "g");
		return text.replace(regex, (matched: string) => {
			const entry = this._values.get(matched);
			if (entry === undefined) {
				return matched;
			}
			entry.occurrences++;
			this._occurrences++;
			this._replaced = true;
			this._kindCounts.set(entry.kind, (this._kindCounts.get(entry.kind) ?? 0) + 1);
			return entry.token;
		});
	}

	/**
	 * 构造已知值的组合正则（按长度倒序，避免短值抢先匹配）。
	 */
	private _knownValuesPattern(): RegExp | null {
		if (this._knownPattern !== null && this._knownPatternVersion === this._valueVersion) {
			return this._knownPattern;
		}
		const candidates: string[] = [];
		for (const value of this._values.keys()) {
			if (value.length >= MIN_PROPAGATE_LENGTH) {
				candidates.push(value);
			}
		}
		if (candidates.length === 0) {
			this._knownPattern = null;
			this._knownPatternVersion = this._valueVersion;
			return null;
		}
		candidates.sort((left, right) => right.length - left.length);
		const source = candidates.slice(0, MAX_PROPAGATE_VALUES).map(escapeRegExp).join("|");
		this._knownPattern = new RegExp(source, "g");
		this._knownPatternVersion = this._valueVersion;
		return this._knownPattern;
	}

	/**
	 * 把命中改写为占位符。
	 * @param text - 扫描文本
	 * @param hits - 命中列表（已排序且不重叠）
	 */
	private _applyHits(text: string, hits: readonly ScanHit[]): string {
		let output = "";
		let cursor = 0;
		for (const hit of hits) {
			if (hit.start < cursor) {
				continue;
			}
			output += text.slice(cursor, hit.start);
			cursor = hit.end;
			if (this.actionFor(hit.kind) === "off") {
				output += hit.value;
				continue;
			}
			if (this.actionFor(hit.kind) === "warn") {
				output += hit.value;
				this._countHit(hit.kind, hit.value);
				continue;
			}
			output += this._register(hit.kind, hit.value);
			this._replaced = true;
		}
		output += text.slice(cursor);
		return output;
	}

	/**
	 * 登记一个新值并返回它的占位符。
	 * @param kind - 敏感类型
	 * @param value - 原始值
	 */
	private _register(kind: PrivacyKind, value: string): string {
		const existing = this._values.get(value);
		if (existing !== undefined) {
			existing.occurrences++;
			this._occurrences++;
			this._kindCounts.set(kind, (this._kindCounts.get(kind) ?? 0) + 1);
			return existing.token;
		}
		const token = placeholderCodec.token(kind, value);
		this._values.set(value, { kind: kind, token: token, occurrences: 1 });
		this._tokens.set(token, value);
		this._valueVersion++;
		this._occurrences++;
		this._kindCounts.set(kind, (this._kindCounts.get(kind) ?? 0) + 1);
		return token;
	}

	/**
	 * 只计数不替换（warn 模式）。
	 * @param kind - 敏感类型
	 * @param value - 原始值
	 */
	private _countHit(kind: PrivacyKind, value: string): void {
		const existing = this._values.get(value);
		if (existing !== undefined) {
			existing.occurrences++;
		} else {
			const token = placeholderCodec.token(kind, value);
			this._values.set(value, { kind: kind, token: token, occurrences: 1 });
			this._tokens.set(token, value);
			this._valueVersion++;
		}
		this._occurrences++;
		this._kindCounts.set(kind, (this._kindCounts.get(kind) ?? 0) + 1);
	}
}

/**
 * 判断一个字符串是否已经被完整改写为占位符。
 * @param value - 待判断字符串
 */
export function isFullyMasked(value: string): boolean {
	return isPlaceholderToken(value);
}
