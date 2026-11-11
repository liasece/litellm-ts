/**
 * 跨供应商 reasoning 签名的目标兼容约束。
 *
 * 协议转换层只负责搬运签名；目标上游是否能解密/接受签名属于目标约束。
 * 这里集中放置约束，避免各 Provider 各写一份形状判断。
 */

/** Codex 原生 reasoning 加密载荷的 Fernet-like 前缀。 */
const CODEX_ENCRYPTED_CONTENT_PREFIX = "gAAAA";

/** Codex 原生加密载荷最短长度（版本 + 时间戳 + IV + 至少一个密文块 + HMAC）。 */
const CODEX_ENCRYPTED_CONTENT_MIN_BYTES = 73;

/** 与 Go 侧一致的加密载荷最大长度，避免异常大字段进入后续处理。 */
const CODEX_ENCRYPTED_CONTENT_MAX_CHARS = 32 * 1024 * 1024;

/** OpenRouter 等路由附加在原生载荷后的点分后缀上限。 */
const ROUTER_SUFFIX_MAX_LENGTH = 128;

/** DeepSeek 等供应商把 thinking 签名实现为请求级 UUID。 */
const UUID_SIGNATURE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Claude 压缩胶囊的前缀；只对 Claude 目标有意义。 */
const COMPACTION_CAPSULE_PREFIX = "cpa-ag-compact-v1:";

/** Kimi 两种协议模式的 thinking 签名固定长度。 */
const KIMI_SIGNATURE_LENGTHS: ReadonlySet<number> = new Set([4340, 12946]);

/**
 * 校验并归一化 Codex reasoning/compaction 的 encrypted_content。
 *
 * Codex 会解密回放的 encrypted_content；其它供应商的 thinking signature
 * 即使只是原样转发也会返回 400 "could not be verified"。这里只做传输形状
 * 校验，不证明可解密，但能可靠剔除 Claude/DeepSeek/Gemini 等外来签名。
 *
 * 合法的路由器点分后缀会被剥离，只把原生载荷交给 Codex。
 * @param raw - 上游回放的 encrypted_content
 * @returns 可回放的原生载荷；不是 Codex 形状时返回 undefined
 */
export function normalizeCodexEncryptedContent(raw: string): string | undefined {
	const trimmed = raw.trim();
	if (trimmed.length === 0 || trimmed.length > CODEX_ENCRYPTED_CONTENT_MAX_CHARS) {
		return undefined;
	}
	if (!trimmed.startsWith(CODEX_ENCRYPTED_CONTENT_PREFIX)) {
		return undefined;
	}
	const separator = trimmed.indexOf(".");
	const native = separator === -1 ? trimmed : trimmed.slice(0, separator);
	if (separator !== -1) {
		const suffix = trimmed.slice(separator + 1);
		if (suffix.length === 0 || suffix.length > ROUTER_SUFFIX_MAX_LENGTH || !/^[A-Za-z0-9]+$/.test(suffix)) {
			return undefined;
		}
	}
	if (!/^[A-Za-z0-9_-]+={0,2}$/.test(native)) {
		return undefined;
	}
	const decoded = Buffer.from(native, "base64url");
	if (decoded.length < CODEX_ENCRYPTED_CONTENT_MIN_BYTES || decoded[0] !== 0x80) {
		return undefined;
	}
	const ciphertextBytes = decoded.length - 1 - 8 - 16 - 32;
	if (ciphertextBytes <= 0 || ciphertextBytes % 16 !== 0) {
		return undefined;
	}
	return native;
}

/** 可用于目标匹配的签名家族。 */
export type SignatureFamily = "gpt" | "claude" | "gemini" | "kimi" | "unknown";

/** 顶层 protobuf 字段。 */
interface ProtobufField {
	readonly number: number;
	readonly wire: number;
	readonly value?: number;
	readonly bytes?: Buffer;
}

/**
 * 读取 protobuf varint。
 * @param buffer - 输入字节
 * @param offset - 起始偏移
 * @returns 数值与下一偏移；非法时 undefined
 */
function readVarint(buffer: Buffer, offset: number): { readonly value: number; readonly next: number } | undefined {
	let value = 0;
	let shift = 0;
	let cursor = offset;
	while (cursor < buffer.length) {
		const byte = buffer[cursor];
		if (byte === undefined) {
			return undefined;
		}
		value += (byte & 0x7f) * 2 ** shift;
		cursor += 1;
		if ((byte & 0x80) === 0) {
			return { value: value, next: cursor };
		}
		shift += 7;
		if (shift > 35) {
			return undefined;
		}
	}
	return undefined;
}

/**
 * 扫描一段 protobuf 的顶层字段；只用于区分 Claude 与 Gemini 的 E 开头信封。
 * @param buffer - 解码后的 protobuf
 * @returns 字段列表；格式非法时 undefined
 */
function scanProtobufFields(buffer: Buffer): ProtobufField[] | undefined {
	const fields: ProtobufField[] = [];
	let offset = 0;
	while (offset < buffer.length) {
		const tag = readVarint(buffer, offset);
		if (!tag || tag.value === 0) {
			return undefined;
		}
		const fieldNumber = Math.floor(tag.value / 8);
		const wire = tag.value & 0x07;
		if (fieldNumber <= 0) {
			return undefined;
		}
		offset = tag.next;
		if (wire === 0) {
			const value = readVarint(buffer, offset);
			if (!value) {
				return undefined;
			}
			fields.push({ number: fieldNumber, wire: wire, value: value.value });
			offset = value.next;
			continue;
		}
		if (wire === 2) {
			const length = readVarint(buffer, offset);
			if (!length || length.value < 0 || length.next + length.value > buffer.length) {
				return undefined;
			}
			fields.push({
				number: fieldNumber,
				wire: wire,
				bytes: buffer.subarray(length.next, length.next + length.value),
			});
			offset = length.next + length.value;
			continue;
		}
		if (wire === 1) {
			if (offset + 8 > buffer.length) {
				return undefined;
			}
			offset += 8;
			continue;
		}
		if (wire === 5) {
			if (offset + 4 > buffer.length) {
				return undefined;
			}
			offset += 4;
			continue;
		}
		return undefined;
	}
	return fields;
}

/**
 * 解码 base64；Claude/Gemini 的签名都可能省略 padding。
 * @param value - base64 字符串
 */
function decodeSignatureBase64(value: string): Buffer | undefined {
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
		return undefined;
	}
	return Buffer.from(value, "base64");
}

/**
 * 判断签名家族。
 *
 * Claude 的经典 E 信封是 `field 2` 容器 + `field 3=1`，Gemini 的 E 信封只有
 * `field 2`；R 是 E 的双层包装，Q/C 是 Claude CAQS/CAIS 包装。该结构差异
 * 足以在目标边界区分两家的 E 开头签名，避免把一家的签名回放给另一家。
 * 无法结构确认的值返回 unknown，由调用方保守处理。
 * @param raw - thinking signature / encrypted_content
 * @returns 签名家族
 */
export function classifySignatureFamily(raw: string): SignatureFamily {
	const value = raw.trim();
	if (value.length === 0 || value.length > CODEX_ENCRYPTED_CONTENT_MAX_CHARS) {
		return "unknown";
	}
	if (value.startsWith(CODEX_ENCRYPTED_CONTENT_PREFIX)) {
		return "gpt";
	}
	if (KIMI_SIGNATURE_LENGTHS.has(value.length) && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
		return "kimi";
	}
	const first = value[0];
	if (first === "C" || first === "Q") {
		return decodeSignatureBase64(value) === undefined ? "unknown" : "claude";
	}
	if (first === "R") {
		const outer = decodeSignatureBase64(value);
		if (!outer || outer[0] !== 0x45) {
			return "unknown";
		}
		const inner = decodeSignatureBase64(outer.toString("ascii"));
		return inner && inner[0] === 0x12 ? "claude" : "unknown";
	}
	if (first !== "E") {
		return "unknown";
	}
	const decoded = decodeSignatureBase64(value);
	if (!decoded || decoded[0] !== 0x12) {
		return "unknown";
	}
	const fields = scanProtobufFields(decoded);
	if (!fields || fields.length === 0) {
		return "unknown";
	}
	if (fields.some((field) => field.number === 3 && field.wire === 0 && field.value === 1)) {
		return "claude";
	}
	if (fields.length === 1 && fields[0]?.number === 2 && fields[0]?.wire === 2) {
		return "gemini";
	}
	return "unknown";
}

/**
 * 判断签名是否明确不属于任何可回放的供应商原生签名。
 *
 * 这里只识别能可靠排除的几类「外来签名」：Codex 的 Fernet 前缀、DeepSeek
 * 的 UUID、Claude 的压缩胶囊、Kimi 的固定长度签名。Claude 与 Gemini 的
 * 签名都可能是 E 开头的 base64，无法仅凭前缀区分，因此保持原样，交给
 * 各自目标的上游校验；不在本函数里猜测。
 *
 * 该判断用于目标边界：命中的值不能回放给任何其它供应商，避免把 Codex /
 * DeepSeek 的签名写进 Claude、Gemini 或 xAI 的对应字段后触发 400。
 * @param raw - 待判断的签名或 encrypted_content
 * @returns 是否可确定是外来签名
 */
export function isDefinitelyForeignSignature(raw: string): boolean {
	const value = raw.trim();
	if (value.length === 0) {
		return false;
	}
	if (value.startsWith(CODEX_ENCRYPTED_CONTENT_PREFIX)) {
		return true;
	}
	if (value.startsWith(COMPACTION_CAPSULE_PREFIX)) {
		return true;
	}
	if (UUID_SIGNATURE_PATTERN.test(value)) {
		return true;
	}
	return KIMI_SIGNATURE_LENGTHS.has(value.length) && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}
