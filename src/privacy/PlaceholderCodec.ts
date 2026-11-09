/**
 * 占位符编解码。
 *
 * 占位符形态为 `{{KIND_hash8}}`：类型 + 8 位带密钥的 HMAC 片段。
 * 同一个值在任何请求、任何轮次都会得到同一个占位符，这是三条硬约束的前提：
 * 1. 多轮对话重复发送的历史前缀逐字节稳定，供应商侧 prompt cache 不会被脱敏打散；
 * 2. Anthropic thinking 签名覆盖的是上游看到的字节，回传时重新脱敏必须得到同一串文本；
 * 3. 还原只需要本次请求内存里的映射，不需要把原文持久化到任何地方。
 *
 * 字符集只使用小写字母与 2-7 的数字，既不会出现在 JSON 转义序列里，
 * 也不会命中 base64 的 `+` / `/` / `=`，因此写进 `image_url` 一类字段也不会破坏数据。
 */
import { createHmac } from "node:crypto";
import type { PrivacyKindName } from "./PrivacyKinds";

/** 占位符识别正则；kind 段只允许大写字母、数字与下划线，hash 段固定 8 位 base32 字符 */
export const PLACEHOLDER_PATTERN = /\{\{([A-Z][A-Z0-9_]{1,23})_([a-z2-7]{8})\}\}/g;

/** 占位符可用的 32 个字符（RFC 4648 base32 小写，去掉 0/1/8/9 等易混字符） */
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/** 单个占位符的最大长度：`{{` + 24 + `_` + 8 + `}}` */
export const MAX_PLACEHOLDER_LENGTH = 38;

/** 进程内占位符缓存上限；超过后整体清空，避免长期运行累积 */
const CACHE_LIMIT = 8192;

/**
 * 把 5 字节摘要编码成 8 位 base32。
 * @param digest - HMAC 摘要
 */
function encodeDigest(digest: Buffer): string {
	let bits = 0;
	let value = 0;
	let output = "";
	for (let index = 0; index < 5; index++) {
		value = (value << 8) | digest[index]!;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			output += BASE32_ALPHABET[(value >>> bits) & 31];
		}
	}
	return output;
}

/**
 * 解析占位符签名密钥。
 *
 * 优先级：`PRIVACY_REDACTION_SECRET` → `LITELLM_SALT_KEY` → `LITELLM_MASTER_KEY` → 内置常量。
 * 前三个都由部署环境提供；都没有时仍然工作，只是不同部署之间占位符不可互通
 * （本来就无需互通：映射只存在于单次请求内存中）。
 * @returns 用于 HMAC 的密钥材料
 */
export function resolvePlaceholderSecret(): string {
	const explicit = process.env["PRIVACY_REDACTION_SECRET"];
	if (typeof explicit === "string" && explicit.trim().length > 0) {
		return `privacy:${explicit.trim()}`;
	}
	const salt = process.env["LITELLM_SALT_KEY"];
	if (typeof salt === "string" && salt.length > 0) {
		return `privacy:salt:${salt}`;
	}
	const master = process.env["LITELLM_MASTER_KEY"];
	if (typeof master === "string" && master.length > 0) {
		return `privacy:master:${master}`;
	}
	return "privacy:litellm-ts:default";
}

/**
 * 判断字符串是否是本模块生成的占位符形态。
 * @param value - 待判断的字符串
 */
export function isPlaceholderToken(value: string): boolean {
	if (value.length < 8 || value.length > MAX_PLACEHOLDER_LENGTH) {
		return false;
	}
	PLACEHOLDER_PATTERN.lastIndex = 0;
	const match = PLACEHOLDER_PATTERN.exec(value);
	PLACEHOLDER_PATTERN.lastIndex = 0;
	return match !== null && match.index === 0 && match[0].length === value.length;
}

/** 假值里各类字符的字母表（避免形近字符，方便人工核对） */
const SHAPE_ALPHABET: Readonly<Record<"upper" | "lower" | "digit", string>> = {
	upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
	lower: "abcdefghijkmnopqrstuvwxyz",
	digit: "23456789",
};

/** 允许伪造的最大长度：更长的值仍用占位符，避免假值本身成为噪声 */
const SHAPE_MAX_LENGTH = 64;

/** 占位符生成与识别器 */
export class PlaceholderCodec {
	private readonly _secret: string;
	private readonly _cache = new Map<string, string>();
	private readonly _shapes = new Map<string, string>();

	/**
	 * @param secret - HMAC 密钥材料；缺省按部署环境解析
	 */
	constructor(secret?: string) {
		this._secret = secret ?? resolvePlaceholderSecret();
	}

	/**
	 * 计算某个值的占位符。
	 * @param kind - 敏感类型
	 * @param value - 原始值
	 * @returns 形如 `{{EMAIL_k3v9x2mq}}` 的占位符
	 */
	token(kind: PrivacyKindName, value: string): string {
		const cacheKey = `${kind}\u0000${value}`;
		const cached = this._cache.get(cacheKey);
		if (cached !== undefined) {
			return cached;
		}
		const digest = createHmac("sha256", this._secret).update(cacheKey).digest();
		const token = `{{${kind}_${encodeDigest(digest)}}}`;
		if (this._cache.size >= CACHE_LIMIT) {
			this._cache.clear();
		}
		this._cache.set(cacheKey, token);
		return token;
	}

	/**
	 * 生成「同形态假值」：保留长度与字符类别，只换字符。
	 *
	 * 用于上游会校验值形态的凭据类。同一个值在同一次部署里始终得到同一个假值，
	 * 因此重复出现与多轮历史都稳定；假值只在本请求内存里能换回原文。
	 * @param kind - 敏感类型
	 * @param value - 原始值
	 * @returns 假值；值太长或为空时返回 null，由调用方回退到占位符
	 */
	shape(kind: PrivacyKindName, value: string): string | null {
		if (value.length === 0 || value.length > SHAPE_MAX_LENGTH) {
			return null;
		}
		const cacheKey = `${kind}\u0000${value}`;
		const cached = this._shapes.get(cacheKey);
		if (cached !== undefined) {
			return cached;
		}
		const replaced: string[] = [];
		let stream: Buffer = Buffer.alloc(0);
		let cursor = 0;
		let counter = 0;
		const nextByte = (): number => {
			if (cursor >= stream.length) {
				stream = createHmac("sha256", this._secret).update(`shape:${cacheKey}:${counter}`).digest();
				cursor = 0;
				counter++;
			}
			const byte = stream[cursor] ?? 0;
			cursor++;
			return byte;
		};
		for (const char of value) {
			if (char >= "A" && char <= "Z") {
				const alphabet = SHAPE_ALPHABET.upper;
				replaced.push(alphabet[nextByte() % alphabet.length] ?? "A");
				continue;
			}
			if (char >= "a" && char <= "z") {
				const alphabet = SHAPE_ALPHABET.lower;
				replaced.push(alphabet[nextByte() % alphabet.length] ?? "a");
				continue;
			}
			if (char >= "0" && char <= "9") {
				const alphabet = SHAPE_ALPHABET.digit;
				replaced.push(alphabet[nextByte() % alphabet.length] ?? "2");
				continue;
			}
			replaced.push(char);
		}
		const shaped = replaced.join("");
		if (this._shapes.size >= CACHE_LIMIT) {
			this._shapes.clear();
		}
		this._shapes.set(cacheKey, shaped);
		return shaped;
	}

	/**
	 * 只计算占位符里的 8 位指纹，用于统计（不返回完整占位符）。
	 * @param kind - 敏感类型
	 * @param value - 原始值
	 */
	hash(kind: PrivacyKindName, value: string): string {
		return this.token(kind, value).slice(kind.length + 3, kind.length + 11);
	}
}

/** 进程级默认编解码器（构造代价可忽略，缓存可跨请求复用） */
export const placeholderCodec = new PlaceholderCodec();

/**
 * 收集一组占位符的所有“可能前缀”，供流式还原时判断是否需要扣住帧尾。
 * 只收集长度 >= 2 的真前缀：单字符前缀（`{`）几乎每段代码都会命中，会让每个事件都延迟一帧。
 * @param tokens - 本次请求已知的占位符集合
 */
export function collectPlaceholderPrefixes(tokens: Iterable<string>): Set<string> {
	const prefixes = new Set<string>();
	for (const token of tokens) {
		for (let length = 2; length < token.length; length++) {
			prefixes.add(token.slice(0, length));
		}
	}
	return prefixes;
}
