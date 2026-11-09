/**
 * 响应写回边界：把占位符还原成原文，再交给客户端。
 *
 * 还原只发生在这里，且只作用于「发出去的字节」：
 * - `res.json` 用与 Express 相同的序列化参数生成字符串，替换后再 `send`，
 *   这样响应体保持 JSON 结构、`Content-Length` 由 Express 重新计算；
 * - SSE（以及 CLIProxy 原生透传）在 `write` 上按帧解析，支持跨帧占位符；
 * - 纯文本 / JSON 文档响应先整体缓冲，最后做一次字面量替换，不需要解析 JSON。
 *
 * 二进制的图片、音频、文件与带 `Content-Encoding` 的响应直接透传，绝不按文本处理。
 */
import type { Request, Response } from "express";
import { StringDecoder } from "node:string_decoder";
import { PlaceholderRestorer } from "./PlaceholderRestorer";
import { SseRewriter } from "./SseRewriter";
import type { PrivacyContext } from "./PrivacyContext";

/** 写回模式 */
type WriteMode = "sse" | "document" | "passthrough";

/** 需要按二进制透传的 Content-Type 前缀 */
const BINARY_CONTENT_TYPES = [
	"image/",
	"audio/",
	"video/",
	"application/octet-stream",
	"application/pdf",
	"application/zip",
	"application/gzip",
	"application/x-tar",
	"font/",
] as const;

/**
 * 判断 Content-Type 是否二进制。
 * @param contentType - 小写 Content-Type
 */
function isBinaryContentType(contentType: string): boolean {
	return BINARY_CONTENT_TYPES.some((prefix) => contentType.startsWith(prefix));
}

/**
 * 判断是否为 JSON 类型（含 `+json` 后缀）。
 * @param contentType - 小写 Content-Type
 */
function isJsonContentType(contentType: string): boolean {
	return contentType.includes("application/json") || contentType.includes("+json");
}

/**
 * 异步触发写回调，保持 Node 的回调时序。
 * @param callback - 原始回调
 */
function invokeCallback(callback: unknown): void {
	if (typeof callback === "function") {
		process.nextTick(callback as () => void);
	}
}

/**
 * 拆分 write/end 的可变参数。
 * @param encodingOrCallback - 第二个参数
 * @param callback - 第三个参数
 */
function splitArgs(
	encodingOrCallback: unknown,
	callback: unknown,
): { encoding: BufferEncoding | undefined; callback: unknown } {
	if (typeof encodingOrCallback === "function") {
		return { encoding: undefined, callback: encodingOrCallback };
	}
	return {
		encoding: typeof encodingOrCallback === "string" ? (encodingOrCallback as BufferEncoding) : undefined,
		callback: callback,
	};
}

/**
 * 安装响应还原。
 * @param res - Express 响应
 * @param context - 本次请求的脱敏上下文
 */
export function installPrivacyResponseWriter(res: Response, context: PrivacyContext): void {
	if (!context.hasReplacements) {
		return;
	}
	const restorer = new PlaceholderRestorer({
		tokens: context.tokenMap,
		onUnresolved: () => context.noteUnresolved(),
	});
	const sse = new SseRewriter(restorer);
	let mode: WriteMode | null = null;
	let documentBuffer = "";
	let documentIsJson = false;
	// 上游分片的字节边界可能切开多字节字符，必须用 StringDecoder 跨分片解码。
	let decoder: StringDecoder | null = null;

	const originalWrite = res.write.bind(res) as (...args: unknown[]) => boolean;
	const originalEnd = res.end.bind(res) as (...args: unknown[]) => Response;
	const originalJson = res.json.bind(res) as (body?: unknown) => Response;

	/**
	 * 首次写出时确定模式：看响应头，而不是猜内容。
	 * @param sample - 首个分片文本
	 */
	const resolveMode = (sample: string): WriteMode => {
		const contentEncoding = String(res.getHeader("content-encoding") ?? "");
		if (contentEncoding.length > 0 && contentEncoding !== "identity") {
			return "passthrough";
		}
		const contentType = String(res.getHeader("content-type") ?? "").toLowerCase();
		if (contentType.includes("text/event-stream")) {
			return "sse";
		}
		if (contentType.length === 0) {
			return sample.startsWith("data:") || sample.startsWith("event:") ? "sse" : "passthrough";
		}
		if (isBinaryContentType(contentType)) {
			return "passthrough";
		}
		documentIsJson = isJsonContentType(contentType);
		return "document";
	};

	/**
	 * 处理一个分片。
	 * @param chunk - 原始分片
	 * @param encoding - 编码
	 * @param callback - 回调
	 */
	const handleChunk = (chunk: unknown, encoding: BufferEncoding | undefined, callback: unknown): boolean => {
		if (chunk === undefined) {
			invokeCallback(callback);
			return true;
		}
		const isBuffer = Buffer.isBuffer(chunk);
		const text = typeof chunk === "string" ? chunk : isBuffer ? (decoder ??= new StringDecoder("utf8")).write(chunk) : String(chunk);
		if (mode === null) {
			mode = resolveMode(text);
		}
		if (mode === "passthrough") {
			return originalWrite(chunk, encoding, callback);
		}
		if (mode === "document") {
			documentBuffer += text;
			invokeCallback(callback);
			return true;
		}
		const output = sse.push(text);
		if (output.length > 0) {
			return originalWrite(output, encoding, callback);
		}
		invokeCallback(callback);
		return true;
	};

	/**
	 * 收尾：按模式把缓冲内容还原后写出。
	 */
	const finish = (): void => {
		const trailing = decoder?.end() ?? "";
		if (mode === "sse") {
			if (trailing.length > 0) {
				const flushed = sse.push(trailing);
				if (flushed.length > 0) {
					originalWrite(flushed);
				}
			}
			const tail = sse.finish();
			if (tail.length > 0) {
				originalWrite(tail);
			}
			originalEnd();
			return;
		}
		if (mode === "document") {
			const restored = restorer.restoreDocument(documentBuffer + trailing, documentIsJson ? "json" : "text");
			documentBuffer = "";
			if (restored.length > 0) {
				// 还原可能改变字节数：去掉上游或 Express 预先写入的长度，交给分块传输。
				res.removeHeader("content-length");
				originalWrite(restored);
			}
			originalEnd();
			return;
		}
		originalEnd();
	};

	res.write = function writeWithPrivacy(chunk: unknown, encodingOrCallback?: unknown, callback?: unknown): boolean {
		const args = splitArgs(encodingOrCallback, callback);
		return handleChunk(chunk, args.encoding, args.callback);
	} as typeof res.write;

	res.end = function endWithPrivacy(chunk?: unknown, encodingOrCallback?: unknown, callback?: unknown): Response {
		const args = splitArgs(encodingOrCallback, callback);
		if (chunk !== undefined && chunk !== null) {
			handleChunk(chunk, args.encoding, undefined);
		}
		finish();
		invokeCallback(args.callback);
		return res;
	} as typeof res.end;

	res.json = function jsonWithPrivacy(body?: unknown): Response {
		if (mode !== null) {
			return originalJson(body);
		}
		const app = (res as unknown as { req?: Request }).req?.app;
		const replacer = app !== undefined ? (app.get("json replacer") as ((key: string, value: unknown) => unknown) | undefined) : undefined;
		const spaces = app !== undefined ? (app.get("json spaces") as number | string | undefined) : undefined;
		let json: string | undefined;
		try {
			json = JSON.stringify(body, replacer, spaces);
		} catch {
			return originalJson(body);
		}
		if (json === undefined) {
			return originalJson(body);
		}
		const restored = restorer.restoreDocument(json, "json");
		if (res.getHeader("content-type") === undefined) {
			res.setHeader("Content-Type", "application/json; charset=utf-8");
		}
		res.send(restored);
		return res;
	} as typeof res.json;
}
