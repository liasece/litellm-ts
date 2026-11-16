/**
 * 响应还原写入器：首次写出发生在脱敏之前的流式响应也必须还原。
 *
 * 背景：Responses 原生流会在发往上游之前写出 response.created 等首帧，此时
 * PrivacyContext 还没有 token。写入器若按「没有替换就透传」锁定模式，整条流都会
 * 绕过还原器，占位符直接发给客户端（线上 opencode-go /v1/responses 的故障）。
 */
import type { Response } from "express";
import { parsePrivacyMaskingSettings } from "./PrivacyConfig";
import { PrivacyContext } from "./PrivacyContext";
import { installPrivacyResponseWriter } from "./PrivacyResponseWriter";

/**
 * 构造最小可用的 Express Response 替身。
 * @param contentType - 响应 Content-Type
 * @param contentEncoding - 响应 Content-Encoding
 */
function createResponse(contentType: string, contentEncoding?: string) {
	const headers = new Map<string, unknown>();
	const chunks: string[] = [];
	const res = {
		headersSent: false,
		getHeader: (name: string) => headers.get(name.toLowerCase()),
		setHeader: (name: string, value: unknown) => {
			headers.set(name.toLowerCase(), value);
		},
		removeHeader: (name: string) => {
			headers.delete(name.toLowerCase());
		},
		write: (chunk: unknown) => {
			chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"));
			return true;
		},
		end: () => {
			res.headersSent = true;
			return res;
		},
		json: () => res,
	};
	headers.set("content-type", contentType);
	if (contentEncoding !== undefined) {
		headers.set("content-encoding", contentEncoding);
	}
	return { res: res as unknown as Response, chunks: chunks };
}

/**
 * 构造脱敏上下文。
 */
function createContext(): PrivacyContext {
	const settings = parsePrivacyMaskingSettings({});
	return new PrivacyContext({ settings: settings, customWords: settings.customWords, configuredSecrets: [], rules: [] });
}

describe("PrivacyResponseWriter", () => {
	it("首帧早于脱敏的 SSE 流仍然还原占位符", () => {
		const { res, chunks } = createResponse("text/event-stream; charset=utf-8");
		const context = createContext();
		installPrivacyResponseWriter(res, context);

		// 首帧由端点在上游请求之前写出，此时还没有任何替换。
		res.write('event: response.created\ndata: {"type":"response.created"}\n\n');
		expect(context.hasReplacements).toBe(false);

		// 发往上游前完成脱敏：token 表在首帧之后才出现。
		const masked = context.maskText("ssh root@probe-a7f3k2@probe-mail.com 'echo ok'");
		expect(context.hasReplacements).toBe(true);
		const token = masked.match(/\{\{EMAIL_[a-z2-7]{8}\}\}/)?.[0];
		expect(token).toBeDefined();

		res.write(`event: response.output_text.done\ndata: {"type":"response.output_text.done","text":"${masked}"}\n\n`);
		res.end();

		const output = chunks.join("");
		expect(output).toContain("probe-a7f3k2@probe-mail.com");
		expect(output).not.toContain(token as string);
		expect(context.snapshotStats().unresolved).toBe(0);
	});

	it("跨帧切开的占位符同样还原", () => {
		const { res, chunks } = createResponse("text/event-stream");
		const context = createContext();
		const masked = context.maskText("root@probe-a7f3k2@probe-mail.com");
		const token = masked.match(/\{\{EMAIL_[a-z2-7]{8}\}\}/)?.[0] as string;
		installPrivacyResponseWriter(res, context);

		const cut = token.indexOf("_") + 2;
		const frame = (text: string) =>
			`event: response.output_text.delta\ndata: {"type":"response.output_text.delta","item_id":"msg_1","delta":"${text}"}\n\n`;
		res.write(frame("root@" + token.slice(0, cut)));
		res.write(frame(token.slice(cut)));
		res.end();

		const output = chunks.join("");
		expect(output).toContain("probe-a7f3k2@probe-mail.com");
		expect(output).not.toContain(token);
	});

	it("未脱敏期间的 SSE 分片原样直通", () => {
		const { res, chunks } = createResponse("text/event-stream");
		const context = createContext();
		installPrivacyResponseWriter(res, context);

		const frame = 'event: response.created\ndata: {"type":"response.created"}\n\n';
		res.write(frame);
		expect(chunks.join("")).toBe(frame);
		expect(context.snapshotStats().unresolved).toBe(0);
	});

	it("未知占位符计入 unresolved", () => {
		const { res } = createResponse("text/event-stream");
		const context = createContext();
		context.maskText("root@probe-a7f3k2@probe-mail.com");
		installPrivacyResponseWriter(res, context);

		res.write('event: response.output_text.delta\ndata: {"delta":"{{EMAIL_zzzzzzzz}}"}\n\n');
		res.end();

		expect(context.snapshotStats().unresolved).toBe(1);
	});

	it("带 Content-Encoding 的响应保持透传", () => {
		const { res, chunks } = createResponse("text/event-stream", "gzip");
		const context = createContext();
		context.maskText("root@probe-a7f3k2@probe-mail.com");
		installPrivacyResponseWriter(res, context);

		const frame = 'event: response.output_text.delta\ndata: {"delta":"root@{{EMAIL_zzzzzzzz}}"}\n\n';
		res.write(frame);
		res.end();

		expect(chunks.join("")).toContain("{{EMAIL_zzzzzzzz}}");
		expect(context.snapshotStats().unresolved).toBe(0);
	});
});
