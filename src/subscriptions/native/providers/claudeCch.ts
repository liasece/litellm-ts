/**
 * Claude Messages 的 CCH 计费签名。
 *
 * Claude Code 会在 `x-anthropic-billing-header` 系统块里写入一个 5 位十六进制
 * 校验值 `cch`，取值是请求体按固定规则归一化后的 xxHash64（种子
 * {@link CLAUDE_CCH_SEED}）低 20 位。这里按 2.1.220 的字节级规则重放：
 *
 * - 所有 `model` 字符串值清空（任意层级），让同一会话在换模型别名时保持稳定；
 * - 顶层派发字段 `max_tokens` / `fallbacks` / `fallback_credit_token` 整段剔除；
 * - 不重新序列化 JSON，只在原始字节上做删除编辑，避免空白与键顺序变化。
 *
 * 签名只改请求体里已有的 5 位占位符 `00000`，因此签名前的请求体必须已经包含
 * 计费头占位符（见 {@link claudeBillingHeader}）。
 */

import { createHash } from "node:crypto";

/** Claude Code CCH 哈希种子。 */
const CLAUDE_CCH_SEED = 0x4d659218e32a3268n;

/** CCH 十六进制位数。 */
const CLAUDE_CCH_LENGTH = 5;

/** CCH 占位符。 */
const CLAUDE_CCH_ZERO = "00000";

/** 构建指纹盐。 */
const CLAUDE_FINGERPRINT_SALT = "59cf53e54c78";

/** 64 位掩码。 */
const MASK_64 = 0xffffffffffffffffn;

/** xxHash64 质数 1。 */
const PRIME_64_1 = 0x9e3779b185ebca87n;

/** xxHash64 质数 2。 */
const PRIME_64_2 = 0xc2b2ae3d27d4eb4fn;

/** xxHash64 质数 3。 */
const PRIME_64_3 = 0x165667b19e3779f9n;

/** xxHash64 质数 4。 */
const PRIME_64_4 = 0x85ebca77c2b2ae63n;

/** xxHash64 质数 5。 */
const PRIME_64_5 = 0x27d4eb2f165667c5n;

/** 需要从哈希视图剔除的顶层派发字段。 */
const CLAUDE_CCH_EXCLUDED_KEYS: ReadonlySet<string> = new Set(["max_tokens", "fallbacks", "fallback_credit_token"]);

/** 参与构建指纹采样的消息字符下标。 */
const CLAUDE_FINGERPRINT_INDEXES: readonly number[] = [4, 7, 20];

/** 计费头前缀。 */
export const CLAUDE_BILLING_HEADER_PREFIX = "x-anthropic-billing-header:";

/** 一个字节级编辑区间。 */
interface CchEdit {
	/** 起始字节（含）。 */
	readonly start: number;
	/** 结束字节（不含）。 */
	readonly end: number;
}

/** JSON 对象成员在原文中的位置。 */
interface CchMember {
	/** 成员起点（键的引号）。 */
	readonly start: number;
	/** 成员值结束位置。 */
	readonly end: number;
	/** 前一个逗号位置；首个成员为 -1。 */
	readonly commaBefore: number;
	/** 后一个逗号位置；最后一个成员为 -1。 */
	readonly commaAfter: number;
	/** 是否属于派发字段。 */
	readonly excluded: boolean;
}

/**
 * 可替换的 CCH 签名钩子。
 *
 * 入参是归一化后的请求体文本；返回 5 位小写十六进制则替换内建 xxHash64 结果，
 * 返回 undefined 表示使用内建算法。需要与其它客户端对齐、或接入外部签名服务时使用。
 */
export type ClaudeCchSignatureHook = (normalizedBody: string) => string | undefined;

/** CCH 签名选项。 */
export interface ClaudeCchSigningOptions {
	/** 自定义签名钩子。 */
	readonly hook?: ClaudeCchSignatureHook;
}

/**
 * 计算 xxHash64。
 * @param input - 输入字节
 * @param seed - 64 位种子
 * @returns 无符号 64 位结果
 */
export function xxHash64(input: Buffer, seed: bigint): bigint {
	const length = input.length;
	let offset = 0;
	let hash = (seed + PRIME_64_5 + BigInt(length)) & MASK_64;
	if (length >= 32) {
		let v1 = (seed + PRIME_64_1 + PRIME_64_2) & MASK_64;
		let v2 = (seed + PRIME_64_2) & MASK_64;
		let v3 = seed;
		let v4 = (seed - PRIME_64_1) & MASK_64;
		const limit = length - 32;
		while (offset <= limit) {
			v1 = round64(v1, input.readBigUInt64LE(offset));
			v2 = round64(v2, input.readBigUInt64LE(offset + 8));
			v3 = round64(v3, input.readBigUInt64LE(offset + 16));
			v4 = round64(v4, input.readBigUInt64LE(offset + 24));
			offset += 32;
		}
		hash = (rotateLeft64(v1, 1) + rotateLeft64(v2, 7) + rotateLeft64(v3, 12) + rotateLeft64(v4, 18)) & MASK_64;
		hash = merge64(hash, v1);
		hash = merge64(hash, v2);
		hash = merge64(hash, v3);
		hash = merge64(hash, v4);
		hash = (hash + BigInt(length)) & MASK_64;
	}
	while (offset + 8 <= length) {
		hash = (hash ^ round64(0n, input.readBigUInt64LE(offset))) & MASK_64;
		hash = (rotateLeft64(hash, 27) * PRIME_64_1 + PRIME_64_4) & MASK_64;
		offset += 8;
	}
	if (offset + 4 <= length) {
		hash = (hash ^ ((BigInt(input.readUInt32LE(offset)) * PRIME_64_1) & MASK_64)) & MASK_64;
		hash = (rotateLeft64(hash, 23) * PRIME_64_2 + PRIME_64_3) & MASK_64;
		offset += 4;
	}
	while (offset < length) {
		hash = (hash ^ ((BigInt(input[offset] ?? 0) * PRIME_64_5) & MASK_64)) & MASK_64;
		hash = (rotateLeft64(hash, 11) * PRIME_64_1) & MASK_64;
		offset += 1;
	}
	hash = (hash ^ (hash >> 33n)) & MASK_64;
	hash = (hash * PRIME_64_2) & MASK_64;
	hash = (hash ^ (hash >> 29n)) & MASK_64;
	hash = (hash * PRIME_64_3) & MASK_64;
	return (hash ^ (hash >> 32n)) & MASK_64;
}

/**
 * 64 位循环左移。
 * @param value - 输入
 * @param bits - 位数
 * @returns 移位后的值
 */
function rotateLeft64(value: bigint, bits: number): bigint {
	const shift = BigInt(bits);
	return ((value << shift) | (value >> (64n - shift))) & MASK_64;
}

/**
 * xxHash64 轮函数。
 * @param accumulator - 累加器
 * @param lane - 输入通道
 * @returns 累加后的值
 */
function round64(accumulator: bigint, lane: bigint): bigint {
	let value = (accumulator + lane * PRIME_64_2) & MASK_64;
	value = rotateLeft64(value, 31);
	return (value * PRIME_64_1) & MASK_64;
}

/**
 * xxHash64 合并轮。
 * @param hash - 当前哈希
 * @param lane - 输入通道
 * @returns 合并后的哈希
 */
function merge64(hash: bigint, lane: bigint): bigint {
	return (((hash ^ round64(0n, lane)) & MASK_64) * PRIME_64_1 + PRIME_64_4) & MASK_64;
}

/**
 * 计算 Claude Code 构建指纹（cc_version 末 3 位）。
 *
 * 取首条用户消息文本的 UTF-16 下标 4/7/20（缺失补 `'0'`），与盐和版本号一起做
 * SHA256，取十六进制前 3 位。
 * @param messageText - 首条用户消息文本
 * @param version - 客户端版本号
 * @returns 3 位小写十六进制
 */
export function claudeVersionFingerprint(messageText: string, version: string): string {
	const units: number[] = [];
	for (let index = 0; index < messageText.length; index += 1) {
		units.push(messageText.charCodeAt(index));
	}
	let sampled = "";
	for (const index of CLAUDE_FINGERPRINT_INDEXES) {
		const unit = units[index] ?? 0x30;
		sampled += String.fromCharCode(unit);
	}
	return createHash("sha256")
		.update(`${CLAUDE_FINGERPRINT_SALT}${sampled}${version}`, "utf8")
		.digest("hex")
		.slice(0, 3);
}

/**
 * 生成 Claude Code 计费头文本。
 * @param input - 版本、消息文本与是否带 CCH 占位符
 * @returns 计费头文本（不带 system 块包装）
 */
export function claudeBillingHeader(input: {
	readonly version: string;
	readonly messageText: string;
	readonly entrypoint?: string;
	readonly cch: boolean;
}): string {
	const entrypoint = input.entrypoint?.trim() ? input.entrypoint.trim() : "cli";
	const fingerprint = claudeVersionFingerprint(input.messageText, input.version);
	let header = `${CLAUDE_BILLING_HEADER_PREFIX} cc_version=${input.version}.${fingerprint}; cc_entrypoint=${entrypoint};`;
	if (input.cch) {
		header += ` cch=${CLAUDE_CCH_ZERO};`;
	}
	return header;
}

/**
 * 在请求体中查找 CCH 数字位置。
 * @param body - 请求体文本
 * @returns 5 位数字的起始下标；没有合法占位符时返回 undefined
 */
export function claudeCchDigitsOffset(body: string): number | undefined {
	const billing = body.indexOf(`${CLAUDE_BILLING_HEADER_PREFIX}`);
	if (billing < 0) {
		return undefined;
	}
	let searchFrom = billing;
	while (searchFrom < body.length) {
		const relative = body.indexOf("cch=", searchFrom);
		if (relative < 0) {
			return undefined;
		}
		const digits = relative + "cch=".length;
		const end = digits + CLAUDE_CCH_LENGTH;
		if (body[end] === ";" && isLowerHex(body.slice(digits, end))) {
			return digits;
		}
		searchFrom = digits;
	}
	return undefined;
}

/**
 * 是否为 5 位小写十六进制。
 * @param value - 待判定文本
 */
function isLowerHex(value: string): boolean {
	return value.length === CLAUDE_CCH_LENGTH && /^[0-9a-f]+$/.test(value);
}

/**
 * 归一化请求体以计算 CCH。
 *
 * 只做字节级删除与 `model` 值清空，不做 JSON 重新序列化。
 * @param body - 合法 JSON 文本
 * @returns 归一化后的文本
 * @throws Error 请求体不是合法 JSON 或压缩后出现重叠编辑时抛出
 */
export function normalizeClaudeCchBody(body: string): string {
	const buffer = Buffer.from(body, "utf8");
	const scanner = new ClaudeCchScanner(buffer);
	const normalized = scanner.run();
	return normalized.toString("utf8");
}

/**
 * 计算请求体的 CCH 数字。
 * @param body - 已带 `cch=00000` 占位符的请求体
 * @param options - 签名选项
 * @returns 5 位小写十六进制
 * @throws Error 请求体非法或签名钩子返回值不是 5 位小写十六进制时抛出
 */
export function claudeCchDigits(body: string, options: ClaudeCchSigningOptions = {}): string {
	const normalized = normalizeClaudeCchBody(body);
	const custom = options.hook?.(normalized);
	if (custom !== undefined) {
		if (!isLowerHex(custom)) {
			throw new Error("CCH 签名钩子必须返回 5 位小写十六进制");
		}
		return custom;
	}
	return (xxHash64(Buffer.from(normalized, "utf8"), CLAUDE_CCH_SEED) & 0xfffffn).toString(16).padStart(CLAUDE_CCH_LENGTH, "0");
}

/**
 * 替换请求体中的 CCH 占位符为实际签名。
 * @param body - 已带 `cch=00000` 占位符的请求体
 * @param options - 签名选项
 * @returns 签名后的请求体；没有占位符时原样返回
 * @throws Error 请求体非法或签名钩子返回值不合法时抛出
 */
export function signClaudeCchBody(body: string, options: ClaudeCchSigningOptions = {}): string {
	const offset = claudeCchDigitsOffset(body);
	if (offset === undefined) {
		return body;
	}
	const digits = claudeCchDigits(body, options);
	return `${body.slice(0, offset)}${digits}${body.slice(offset + CLAUDE_CCH_LENGTH)}`;
}

/**
 * 字节级 JSON 扫描器：记录派发字段与 `model` 值的编辑位置。
 */
class ClaudeCchScanner {
	private readonly _body: Buffer;

	private _pos: number;

	private readonly _edits: CchEdit[];

	/**
	 * @param body - 请求体字节
	 */
	constructor(body: Buffer) {
		this._body = body;
		this._pos = 0;
		this._edits = [];
	}

	/**
	 * 执行扫描并返回归一化后的字节。
	 * @returns 归一化结果
	 * @throws Error JSON 非法或编辑区间重叠时抛出
	 */
	run(): Buffer {
		if (this._body.length === 0) {
			throw new Error("CCH 归一化需要非空 JSON 请求体");
		}
		try {
			JSON.parse(this._body.toString("utf8"));
		} catch {
			throw new Error("CCH 归一化输入不是合法 JSON");
		}
		this._parseValue(true);
		this._skipWhitespace();
		if (this._pos !== this._body.length) {
			throw new Error(`CCH 归一化发现多余字节：${this._pos}`);
		}
		const edits = [...this._edits].sort((left, right) => left.start - right.start);
		const chunks: Buffer[] = [];
		let last = 0;
		for (const edit of edits) {
			if (edit.start < last || edit.end > this._body.length) {
				throw new Error(`CCH 归一化编辑区间重叠：${edit.start}`);
			}
			chunks.push(this._body.subarray(last, edit.start));
			last = edit.end;
		}
		chunks.push(this._body.subarray(last));
		return Buffer.concat(chunks);
	}

	/**
	 * 解析一个值。
	 * @param collect - 是否收集编辑
	 * @throws Error 遇到非法 JSON 时抛出
	 */
	private _parseValue(collect: boolean): void {
		this._skipWhitespace();
		const byte = this._body[this._pos];
		if (byte === 0x7b) {
			this._parseObject(collect);
			return;
		}
		if (byte === 0x5b) {
			this._parseArray(collect);
			return;
		}
		if (byte === 0x22) {
			this._parseString();
			return;
		}
		const start = this._pos;
		while (this._pos < this._body.length) {
			const current = this._body[this._pos];
			if (current === undefined) {
				break;
			}
			if (current === 0x2c || current === 0x7d || current === 0x5d || isJsonSpace(current)) {
				if (this._pos === start) {
					throw new Error(`CCH 归一化缺少值：${start}`);
				}
				return;
			}
			this._pos += 1;
		}
		if (this._pos === start) {
			throw new Error(`CCH 归一化缺少值：${start}`);
		}
	}

	/**
	 * 解析对象并记录成员编辑。
	 * @param collect - 是否收集编辑
	 * @throws Error 对象未闭合或成员非法时抛出
	 */
	private _parseObject(collect: boolean): void {
		this._pos += 1;
		this._skipWhitespace();
		if (this._consume(0x7d)) {
			return;
		}
		const members: CchMember[] = [];
		let commaBefore = -1;
		for (;;) {
			this._skipWhitespace();
			const memberStart = this._pos;
			const key = this._parseString();
			this._skipWhitespace();
			if (!this._consume(0x3a)) {
				throw new Error(`CCH 归一化对象缺少冒号：${this._pos}`);
			}
			this._skipWhitespace();
			const excluded = collect && CLAUDE_CCH_EXCLUDED_KEYS.has(key);
			if (collect && key === "model" && this._body[this._pos] === 0x22) {
				const valueStart = this._pos;
				this._parseString();
				const valueEnd = this._pos;
				this._addEdit(valueStart + 1, valueEnd - 1);
			} else {
				this._parseValue(collect && !excluded);
			}
			const memberEnd = this._pos;
			this._skipWhitespace();
			let commaAfter = -1;
			if (this._consume(0x2c)) {
				commaAfter = this._pos - 1;
			}
			members.push({
				start: memberStart,
				end: memberEnd,
				commaBefore: commaBefore,
				commaAfter: commaAfter,
				excluded: excluded,
			});
			if (commaAfter >= 0) {
				commaBefore = commaAfter;
				continue;
			}
			if (!this._consume(0x7d)) {
				throw new Error(`CCH 归一化对象未闭合：${this._pos}`);
			}
			break;
		}
		if (collect) {
			this._addExcludedMemberEdits(members);
		}
	}

	/**
	 * 解析数组。
	 * @param collect - 是否收集编辑
	 * @throws Error 数组未闭合或元素非法时抛出
	 */
	private _parseArray(collect: boolean): void {
		this._pos += 1;
		this._skipWhitespace();
		if (this._consume(0x5d)) {
			return;
		}
		for (;;) {
			this._parseValue(collect);
			this._skipWhitespace();
			if (this._consume(0x2c)) {
				continue;
			}
			if (!this._consume(0x5d)) {
				throw new Error(`CCH 归一化数组未闭合：${this._pos}`);
			}
			return;
		}
	}

	/**
	 * 解析字符串并返回解码后的键名。
	 * @returns 字符串值
	 * @throws Error 字符串未闭合或转义非法时抛出
	 */
	private _parseString(): string {
		if (this._body[this._pos] !== 0x22) {
			throw new Error(`CCH 归一化缺少字符串：${this._pos}`);
		}
		const start = this._pos;
		this._pos += 1;
		while (this._pos < this._body.length) {
			const current = this._body[this._pos];
			if (current === 0x5c) {
				this._pos += 2;
				continue;
			}
			if (current === 0x22) {
				this._pos += 1;
				return JSON.parse(this._body.toString("utf8", start, this._pos)) as string;
			}
			this._pos += 1;
		}
		throw new Error(`CCH 归一化字符串未闭合：${start}`);
	}

	/**
	 * 为连续的派发字段生成删除区间，规则与 2.1.220 一致。
	 * @param members - 对象成员
	 */
	private _addExcludedMemberEdits(members: readonly CchMember[]): void {
		let start = 0;
		while (start < members.length) {
			const first = members[start];
			if (!first || !first.excluded) {
				start += 1;
				continue;
			}
			let end = start;
			for (;;) {
				const next = members[end + 1];
				if (!next || !next.excluded) {
					break;
				}
				end += 1;
			}
			const last = members[end];
			if (!last) {
				return;
			}
			const following = members[end + 1];
			if (following && last.commaAfter >= 0) {
				this._addEdit(first.start, last.commaAfter + 1);
			} else if (start > 0 && end > start) {
				this._addEdit(first.start, last.end);
			} else if (start > 0 && first.commaBefore >= 0) {
				this._addEdit(first.commaBefore, last.end);
			} else {
				this._addEdit(first.start, last.end);
			}
			start = end + 1;
		}
	}

	/**
	 * 记录编辑区间。
	 * @param start - 起点
	 * @param end - 终点
	 */
	private _addEdit(start: number, end: number): void {
		if (start >= end) {
			return;
		}
		this._edits.push({ start: start, end: end });
	}

	/**
	 * 跳过空白。
	 */
	private _skipWhitespace(): void {
		while (this._pos < this._body.length && isJsonSpace(this._body[this._pos] ?? 0)) {
			this._pos += 1;
		}
	}

	/**
	 * 尝试消费一个字节。
	 * @param character - 期望字节
	 */
	private _consume(character: number): boolean {
		if (this._body[this._pos] !== character) {
			return false;
		}
		this._pos += 1;
		return true;
	}
}

/**
 * 是否为 JSON 空白字节。
 * @param byte - 字节
 */
function isJsonSpace(byte: number): boolean {
	return byte === 0x20 || byte === 0x09 || byte === 0x0d || byte === 0x0a;
}
