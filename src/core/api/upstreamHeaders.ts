import { Readable } from "node:stream";
import { createZstdDecompress } from "node:zlib";

/**
 * 上游响应头转发边界。
 *
 * 上游（CLIProxy/Go、其他网关）可能返回 gzip 压缩的 SSE/JSON；服务端用 fetch
 * 读取时已经解压并重新分块写出，原样的 `Content-Encoding` / `Content-Length`
 * 会让 Node/undici 客户端误以为仍是压缩体，触发 `TypeError: terminated`。
 * 因此这些逐跳与实体编码头不得回传。
 */
const BLOCKED_UPSTREAM_RESPONSE_HEADERS = new Set([
	"connection",
	"transfer-encoding",
	"content-length",
	"content-encoding",
	"keep-alive",
	"proxy-connection",
	"upgrade",
]);

/**
 * 判断上游响应头是否可以安全回传给下游。
 * @param name
 */
export function isForwardableUpstreamHeader(name: string): boolean {
	return !BLOCKED_UPSTREAM_RESPONSE_HEADERS.has(name.trim().toLowerCase());
}

/**
 * 构造发往上游的请求头。
 *
 * Node（undici）只自动解码 gzip/deflate/br。上游一旦按调用方声明的 zstd 压缩
 * SSE/JSON，fetch 会把压缩字节原样交回：SSE 解析失败、`usage` 丢失，最终只剩
 * "This operation was aborted" 或零 token 记录。因此这里统一删除 Accept-Encoding，
 * 让 undici 使用自身默认声明并承担解压责任。
 * @param headers - Provider 组装好的请求头
 */
export function sanitizeUpstreamRequestHeaders(headers: Record<string, string> | Headers): Headers {
	// Headers 实例用 Object.entries 取不到任何键，必须先交给 Headers 构造器归一化。
	const sanitized = new Headers(headers as unknown as ConstructorParameters<typeof Headers>[0]);
	sanitized.delete('accept-encoding');
	return sanitized;
}

/** undici 不会自动解码的内容编码。 */
const UNDECODEABLE_CONTENT_ENCODINGS = new Set(["zstd"]);

/**
 * 兜底解码：上游仍返回 undici 不支持的编码时手动解压，保证调用方读到明文，
 * 从而能解析 SSE 与 usage，而不是把压缩字节当成响应内容。
 * @param response - 上游响应
 */
export function decodeUndecodeableResponse(response: Response): Response {
	const responseHeaders = response.headers;
	if (typeof responseHeaders?.get !== "function") {
		// 测试替身或非常规 Response 实现可能没有 headers；此时无法判断编码，原样返回。
		return response;
	}
	const encoding = responseHeaders.get("content-encoding")?.trim().toLowerCase();
	if (encoding === undefined || !UNDECODEABLE_CONTENT_ENCODINGS.has(encoding) || response.body === null) {
		return response;
	}
	const headers = new Headers(responseHeaders);
	headers.delete("content-encoding");
	headers.delete("content-length");
	const source = Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
	const decoded = Readable.toWeb(source.pipe(createZstdDecompress())) as unknown as ConstructorParameters<typeof Response>[0];
	return new Response(decoded, { status: response.status, statusText: response.statusText, headers: headers });
}
