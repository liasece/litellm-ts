/**
 * 占位符还原器。
 *
 * 只在「写回客户端」的边界上工作：把本次请求里出现过的占位符换回原值，
 * 其余字节原样保留。三条约束决定了实现方式：
 *
 * 1. **流式还原要能跨事件拼接**。上游把 `{{API_KEY_ab12cd34}}` 当普通文本按 token
 *    逐步吐出，同一次替换可能被切成多个 delta。还原器为每个内容流维护 carry：
 *    帧尾若是一段「还可能是占位符前缀」的字符就先扣住，等下一段到了再一起还原。
 *    被扣住的字符最终会出现在下一帧里，因此客户端拼接结果与完整还原一致。
 * 2. **签名内容不还原**。Anthropic thinking 块的签名覆盖的是上游看到的字节；
 *    把 thinking 文本换成原文再回传会导致下一轮签名校验失败，因此带签名的
 *    thinking 与 `encrypted_content` 一律原样透传。
 * 3. **文档级还原不需要解析 JSON**。占位符里不含引号、反斜杠与控制字符，
 *    在序列化后的 JSON 上做字面量替换不会破坏结构，也就避免了大响应体
 *    解析 → 改写 → 重序列化带来的耗时与精度风险。
 */
import { PLACEHOLDER_PATTERN, collectPlaceholderPrefixes, isPlaceholderToken } from "./PlaceholderCodec";

/**
 * 还原器构造参数
 */
export interface PlaceholderRestorerInit {
	/** 占位符 → 原文 */
	readonly tokens: ReadonlyMap<string, string>;
	/** 无法还原的占位符数量回调 */
	readonly onUnresolved?: () => void;
}

/** 深度还原时需要跳过的字段名（签名与加密载荷） */
const SKIPPED_KEYS = new Set(["signature", "encrypted_content"]);

/** 占位符还原器 */
export class PlaceholderRestorer {
	private readonly _tokens: ReadonlyMap<string, string>;
	private readonly _pending = new Map<string, string>();
	private readonly _onUnresolved: (() => void) | undefined;
	private _literals: readonly string[] = [];
	private _literalPattern: RegExp | null = null;
	private _prefixes = new Set<string>();
	private _maxTokenLength = 0;
	/** 派生结构对应的 token 数量；token 是后续补进来的（发往上游前才脱敏），必须按需刷新 */
	private _tokenCount = -1;
	private _pattern: RegExp | null = null;

	/**
	 * @param init - 构造参数
	 */
	constructor(init: PlaceholderRestorerInit) {
		this._tokens = init.tokens;
		this._onUnresolved = init.onUnresolved;
		this._refresh();
	}

	/**
	 * token 表增长后重建字面量、前缀集合与最大长度。
	 *
	 * 响应写入器在请求早期安装，而请求体在发往上游前才被替换；构造时拿到的可能
	 * 还是一张空表，因此每次还原前都按 token 数量检查一次。
	 */
	private _refresh(): void {
		if (this._tokenCount === this._tokens.size) {
			return;
		}
		this._tokenCount = this._tokens.size;
		// 占位符与「同形态假值」共用一张表：假值也是要换回原文的字面量。
		const placeholders: string[] = [];
		const literals: string[] = [];
		for (const token of this._tokens.keys()) {
			if (isPlaceholderToken(token)) {
				placeholders.push(token);
			} else {
				literals.push(token);
			}
		}
		literals.sort((left, right) => right.length - left.length);
		this._literals = literals;
		this._literalPattern =
			literals.length === 0
				? null
				: new RegExp(literals.map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
		const prefixes = collectPlaceholderPrefixes(placeholders);
		for (const literal of literals) {
			for (let length = 2; length < literal.length; length++) {
				prefixes.add(literal.slice(0, length));
			}
		}
		this._prefixes = prefixes;
		let maxLength = 0;
		for (const token of this._tokens.keys()) {
			maxLength = Math.max(maxLength, token.length);
		}
		this._maxTokenLength = maxLength;
	}

	/** 是否存在需要还原的占位符 */
	get hasTokens(): boolean {
		return this._tokens.size > 0;
	}

	/** 是否有被扣住的字符 */
	get hasPending(): boolean {
		return this._pending.size > 0;
	}

	/**
	 * 文档级还原：整段文本里的完整占位符一次性替换。
	 *
	 * `json` 模式会按 JSON 字符串内的转义规则插入原值：占位符在序列化后的 JSON 里
	 * 只可能出现在字符串内部，而原文可能含有引号、反斜杠或换行（例如 PEM 私钥），
	 * 直接拼回去会写出非法 JSON。
	 * @param text - 已序列化的响应文本
	 * @param mode - 文档类型：json 或纯文本
	 */
	restoreDocument(text: string, mode: "json" | "text" = "text"): string {
		this._refresh();
		if (this._tokens.size === 0) {
			return text;
		}
		return this._replace(text, mode === "json");
	}

	/**
	 * 流式还原：处理一帧文本，返回可以立即写出的部分。
	 * @param key - 内容流标识（同一路增量必须使用同一个 key）
	 * @param text - 本帧新增文本
	 */
	restoreStreaming(key: string, text: string): string {
		this._refresh();
		if (this._tokens.size === 0) {
			return text;
		}
		const pending = this._pending.get(key);
		if (pending === undefined && this._literals.length === 0 && !text.includes("{{")) {
			// 快速路径：不含占位符起始字符（也没有假值字面量），且此前没有扣留字符
			return text;
		}
		const combined = pending === undefined ? text : `${pending}${text}`;
		const hold = this._longestPrefixSuffix(combined);
		const body = hold.length > 0 ? combined.slice(0, combined.length - hold.length) : combined;
		if (hold.length > 0) {
			this._pending.set(key, hold);
		} else {
			this._pending.delete(key);
		}
		return this._replace(body);
	}

	/**
	 * 取走并清空某个内容流扣住的字符（不再尝试还原）。
	 * @param key - 内容流标识
	 */
	takePending(key: string): string {
		const value = this._pending.get(key) ?? "";
		this._pending.delete(key);
		return value;
	}

	/**
	 * 当前所有被扣住的内容。
	 */
	pendingEntries(): Array<{ key: string; text: string }> {
		const result: Array<{ key: string; text: string }> = [];
		for (const [key, text] of this._pending) {
			result.push({ key: key, text: text });
		}
		return result;
	}

	/**
	 * 深度还原：遍历对象/数组把所有字符串叶子里的占位符换回原文。
	 * @param value - 待还原的值
	 */
	restoreDeep(value: unknown): unknown {
		this._refresh();
		if (typeof value === "string") {
			return this._replace(value);
		}
		if (Array.isArray(value)) {
			for (let index = 0; index < value.length; index++) {
				value[index] = this.restoreDeep(value[index]);
			}
			return value;
		}
		if (typeof value === "object" && value !== null) {
			const record = value as Record<string, unknown>;
			const signedThinking = typeof record["signature"] === "string";
			for (const key of Object.keys(record)) {
				if (SKIPPED_KEYS.has(key)) {
					continue;
				}
				if (signedThinking && key === "thinking") {
					continue;
				}
				record[key] = this.restoreDeep(record[key]);
			}
			return value;
		}
		return value;
	}

	/**
	 * 逐 token 替换，并统计无法还原的占位符。
	 * @param text - 文本
	 * @param escapeJson - 是否按 JSON 字符串转义规则插入原值
	 */
	private _replace(text: string, escapeJson = false): string {
		if (this._tokens.size === 0) {
			return text;
		}
		let output = text;
		if (text.includes("{{")) {
			const pattern = this._getPattern();
			output = text.replace(pattern, (matched: string) => {
				const original = this._tokens.get(matched);
				if (original === undefined) {
					this._onUnresolved?.();
					return matched;
				}
				return escapeJson ? JSON.stringify(original).slice(1, -1) : original;
			});
		}
		if (this._literalPattern !== null) {
			const literalPattern = new RegExp(this._literalPattern.source, "g");
			output = output.replace(literalPattern, (matched: string) => {
				const original = this._tokens.get(matched);
				if (original === undefined) {
					this._onUnresolved?.();
					return matched;
				}
				return escapeJson ? JSON.stringify(original).slice(1, -1) : original;
			});
		}
		return output;
	}

	/**
	 * 复用的全局正则（`replace` 会重置 lastIndex）。
	 */
	private _getPattern(): RegExp {
		if (this._pattern === null) {
			this._pattern = new RegExp(PLACEHOLDER_PATTERN.source, "g");
		}
		return this._pattern;
	}

	/**
	 * 找出文本末尾最长的「可能是某个占位符前缀」的后缀。
	 * @param text - 待检查文本
	 */
	private _longestPrefixSuffix(text: string): string {
		const limit = Math.min(this._maxTokenLength - 1, text.length);
		for (let length = limit; length >= 2; length--) {
			const suffix = text.slice(text.length - length);
			if (this._prefixes.has(suffix)) {
				return suffix;
			}
		}
		return "";
	}
}
