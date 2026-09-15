import type { NextFunction, Request, Response } from "express";
import { zstdDecompressSync } from "node:zlib";

/** 带有 body-parser 内部标记的请求类型 */
interface BodyParsedRequest extends Request {
	_body?: boolean;
}

/**
 * 请求体 zstd 解压中间件。
 * 部分客户端（如 Codex CLI）使用 Content-Encoding: zstd 发送请求，
 * body-parser 无法识别该编码，会抛出 415 unsupported content encoding。
 * 在 express.json() 之前读取并解压 zstd 请求体，自行解析 JSON 后写入 req.body，
 * 并设置 _body 标记使 body-parser 跳过（read.js 会在解析前检查该标记）。
 * 需要 Node >= 22.15（内置 zstd 支持）。
 * @param req
 * @param res
 * @param next
 */
export function zstdRequestDecompress(
	req: BodyParsedRequest,
	res: Response,
	next: NextFunction,
): void {
	if (req.headers["content-encoding"] !== "zstd") {
		next();
		return;
	}
	const chunks: Buffer[] = [];
	req.on("data", (chunk: Buffer) => chunks.push(chunk));
	req.on("end", () => {
		try {
			const body = zstdDecompressSync(Buffer.concat(chunks));
			const contentType = req.headers["content-type"] ?? "";
			if (contentType.includes("application/json")) {
				req.body = JSON.parse(body.toString("utf8"));
			} else {
				req.body = body;
			}
			// 标记请求体已解析，下游 body-parser 直接跳过
			req._body = true;
			next();
		} catch {
			res.status(400).json({
				error: { message: "invalid zstd request body", type: "invalid_request_error" },
			});
		}
	});
	req.on("error", next);
}
