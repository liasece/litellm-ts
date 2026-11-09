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
import { PLACEHOLDER_PATTERN, collectPlaceholderPrefixes } from "./PlaceholderCodec";

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
	private readonly _prefixes: Set<string>;
	private readonly _pending = new Map<string, string>();
	private readonly _maxTokenLength: number;
	private readonly _onUnresolved: (() => void) | undefined;
	private _pattern: RegExp | null = null;

	/**
	 * @param init - 构造参数
	 */
	constructor(init: PlaceholderRestorerInit) {
		this._tokens = init.tokens;
		this._prefixes = collectPlaceholderPrefixes(init.tokens.keys());
		let maxLength = 0;
		for (const token of init.tokens.keys()) {
			maxLength = Math.max(maxLength, token.length);
		}
		this._maxTokenLength = maxLength;
		this._onUnresolved = init.onUnresolved;
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
		if (this._tokens.size === 0) {
			return text;
		}
		const pending = this._pending.get(key);
		if (pending === undefined && !text.includes("{{")) {
			// 快速路径：不含占位符起始字符，且此前没有扣留字符
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
		if (this._tokens.size === 0 || !text.includes("{{")) {
			return text;
		}
		const pattern = this._getPattern();
		return text.replace(pattern, (matched: string) => {
			const original = this._tokens.get(matched);
			if (original === undefined) {
				this._onUnresolved?.();
				return matched;
			}
			if (!escapeJson) {
				return original;
			}
			return JSON.stringify(original).slice(1, -1);
		});
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
