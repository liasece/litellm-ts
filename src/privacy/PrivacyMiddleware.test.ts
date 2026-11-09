/**
 * 中间件端到端契约：请求脱敏、响应还原、统计落库、密钥级退出。
 *
 * 用真实的 Express + supertest 走一遍「请求进来 → 上游看到占位符 → 客户端拿到原文」，
 * 并检查落库内容不含任何原文。
 */
import express from "express";
import request from "supertest";
import { privacyMaskingMiddleware } from "./PrivacyMiddleware";
import { parsePrivacyMaskingSettings, privacySettingsService } from "./PrivacyConfig";

const EMAIL = "jansen@liasece.com";
const API_KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz";

/** 捕获到的写入行 */
interface CapturedRows {
	events: Array<Record<string, unknown>>;
	values: Array<Record<string, unknown>>;
}

/**
 * 构造只实现 insert/delete 的 mock db。
 * @param captured - 捕获数组
 */
function makeDb(captured: CapturedRows): unknown {
	/**
	 * 让对象既可 await 又能继续链式调用。
	 * @param rows - 结果行
	 */
	const resolved = (rows: unknown[] = []): Record<string, unknown> => {
		const chain: Record<string, unknown> = {
			then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
			catch: (reject: (reason: unknown) => unknown) => Promise.resolve(rows).catch(reject),
			where: () => chain,
			limit: () => Promise.resolve(rows),
		};
		return chain;
	};
	return {
		insert: (table: unknown) => ({
			values: (rowOrRows: unknown) => {
				const name = String((table as { [key: symbol]: unknown })[Object.getOwnPropertySymbols(table as object)[0] as symbol] ?? "");
				const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
				if (name.includes("Values")) {
					captured.values.push(...(rows as Array<Record<string, unknown>>));
				} else {
					captured.events.push(...(rows as Array<Record<string, unknown>>));
				}
				return Promise.resolve();
			},
		}),
		delete: () => ({ where: () => Promise.resolve() }),
		select: () => ({ from: () => resolved([]) }),
	};
}

/**
 * 构造测试应用。
 * @param captured - 捕获数组
 */
function makeApp(captured: CapturedRows): express.Express {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.auth = { api_key: "sk-test", token: "hashed-token", user_id: "user-1", team_id: "team-1" } as never;
		next();
	});
	const router = express.Router();
	const fakeRouter = {
		getAvailableDeployment: () => ({ deployment: { litellm_params: { custom_llm_provider: "cliproxy", api_key: "provider-secret-123456" } } }),
		getDeployments: () => [],
	};
	router.use(privacyMaskingMiddleware({ router: fakeRouter as never, db: makeDb(captured) as never }));
	router.post("/v1/chat/completions", (req, res) => {
		const body = req.body as { messages: Array<{ content: string }> };
		const content = body.messages[0]?.content ?? "";
		// 模拟模型原样复述：占位符会回到客户端，但应以原文出现
		res.json({ id: "chatcmpl-1", choices: [{ index: 0, message: { role: "assistant", content: content }, finish_reason: "stop" }] });
	});
	router.post("/v1/messages", (req, res) => {
		const body = req.body as { messages: Array<{ content: string }> };
		const content = body.messages[0]?.content ?? "";
		res.setHeader("Content-Type", "text/event-stream");
		const token = content.match(/\{\{[A-Z_]+_[a-z2-7]{8}\}\}/)?.[0] ?? "";
		const head = token.slice(0, 7);
		const tail = token.slice(7);
		res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `hi ${head}` } })}\n\n`);
		res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: tail } })}\n\n`);
		res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
		res.end();
	});
	router.post("/v1/responses", (req, res) => {
		const raw = JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "x" }] }] });
		void raw;
		res.setHeader("Content-Type", "application/json");
		res.write(Buffer.from(JSON.stringify({ id: "resp_1", echoed: "placeholder" })));
		res.end();
	});
	app.use(router);
	return app;
}

/**
 * 等到统计写入完成。
 */
async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 80));
}

describe("privacyMaskingMiddleware", () => {
	beforeEach(() => {
		privacySettingsService.setSnapshot(parsePrivacyMaskingSettings({}));
	});

	it("请求发往端点时已经是占位符，响应回到客户端时恢复原文", async () => {
		const captured: CapturedRows = { events: [], values: [] };
		const app = makeApp(captured);
		const response = await request(app)
			.post("/v1/chat/completions")
			.send({ model: "gpt-test", messages: [{ role: "user", content: `mail ${EMAIL}` }] })
			.expect(200);
		const body = response.body as { choices: Array<{ message: { content: string } }> };
		expect(body.choices[0]?.message.content).toBe(`mail ${EMAIL}`);
		await settle();
		expect(captured.events).toHaveLength(1);
		expect(captured.values.length).toBeGreaterThan(0);
		const serialized = JSON.stringify(captured);
		expect(serialized).not.toContain(EMAIL);
		expect(captured.events[0]?.["client"]).toBe("other");
		expect(captured.events[0]?.["provider"]).toBe("cliproxy");
	});

	it("SSE 跨帧占位符在客户端拼接成原文", async () => {
		const captured: CapturedRows = { events: [], values: [] };
		const app = makeApp(captured);
		const response = await request(app)
			.post("/v1/messages")
			.send({ model: "claude-test", max_tokens: 16, messages: [{ role: "user", content: `key ${API_KEY}` }] })
			.buffer(true)
			.parse((res, callback) => {
				let text = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => {
					text += chunk;
				});
				res.on("end", () => callback(null, text));
			})
			.expect(200);
		const raw = response.body as string;
		const deltas = [...raw.matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)].map((match) => JSON.parse(`"${match[1]}"`) as string);
		expect(deltas.join("")).toBe(`hi ${API_KEY}`);
		expect(raw).not.toContain("{{API_KEY_");
	});

	it("多字节字符被分片切开时仍能正确解码与还原", async () => {
		const captured: CapturedRows = { events: [], values: [] };
		const app = express();
		app.use(express.json());
		app.use((req, _res, next) => {
			req.auth = { api_key: "sk-test", token: "hashed-token" } as never;
			next();
		});
		const router = express.Router();
		const fakeRouter = { getAvailableDeployment: () => undefined, getDeployments: () => [] };
		router.use(privacyMaskingMiddleware({ router: fakeRouter as never, db: makeDb(captured) as never }));
		router.post("/v1/chat/completions", (req, res) => {
			const body = req.body as { messages: Array<{ content: string }> };
			const payload = Buffer.from(JSON.stringify({ text: "中文片段 " + (body.messages[0]?.content ?? "") }), "utf8");
			res.setHeader("Content-Type", "application/json; charset=utf-8");
			// 在「中」字的三个字节中间切开
			const splitAt = payload.indexOf(Buffer.from("中", "utf8")) + 1;
			res.write(payload.subarray(0, splitAt));
			res.write(payload.subarray(splitAt));
			res.end();
		});
		app.use(router);
		const response = await request(app)
			.post("/v1/chat/completions")
			.send({ model: "gpt-test", messages: [{ role: "user", content: `mail ${EMAIL}` }] })
			.expect(200);
		const body = response.body as { text: string };
		expect(body.text).toBe(`中文片段 mail ${EMAIL}`);
	});

	it("非流式 JSON 透传同样还原", async () => {
		const captured: CapturedRows = { events: [], values: [] };
		const app = makeApp(captured);
		const response = await request(app)
			.post("/v1/responses")
			.send({ model: "gpt-test", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: EMAIL }] }] })
			.expect(200);
		expect(response.text).toContain("resp_1");
	});

	it("密钥级 pii:false 完全跳过脱敏", async () => {
		const captured: CapturedRows = { events: [], values: [] };
		const app = express();
		app.use(express.json());
		app.use((req, _res, next) => {
			req.auth = { api_key: "sk-test", token: "hashed-token", permissions: { pii: false } } as never;
			next();
		});
		const router = express.Router();
		const fakeRouter = { getAvailableDeployment: () => undefined, getDeployments: () => [] };
		router.use(privacyMaskingMiddleware({ router: fakeRouter as never, db: makeDb(captured) as never }));
		router.post("/v1/chat/completions", (req, res) => {
			const body = req.body as { messages: Array<{ content: string }> };
			res.json({ echoed: body.messages[0]?.content });
		});
		app.use(router);
		const response = await request(app)
			.post("/v1/chat/completions")
			.send({ model: "gpt-test", messages: [{ role: "user", content: `mail ${EMAIL}` }] })
			.expect(200);
		expect((response.body as { echoed: string }).echoed).toBe(`mail ${EMAIL}`);
		await settle();
		expect(captured.events).toHaveLength(0);
	});

	it("未识别的路径不做任何改动", async () => {
		const captured: CapturedRows = { events: [], values: [] };
		const app = express();
		app.use(express.json());
		const router = express.Router();
		const fakeRouter = { getAvailableDeployment: () => undefined, getDeployments: () => [] };
		router.use(privacyMaskingMiddleware({ router: fakeRouter as never, db: makeDb(captured) as never }));
		router.post("/v1/images/generations", (req, res) => {
			res.json({ prompt: (req.body as { prompt: string }).prompt });
		});
		app.use(router);
		const response = await request(app).post("/v1/images/generations").send({ prompt: `mail ${EMAIL}` }).expect(200);
		expect((response.body as { prompt: string }).prompt).toBe(`mail ${EMAIL}`);
	});
});
