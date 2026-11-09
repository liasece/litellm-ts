/**
 * 中间件端到端契约：上下文登记、响应还原、统计落库、密钥级退出。
 *
 * 请求体改写已经移到「发往上游前」的调度点，测试里的假端点代替 Router 调用
 * applyPrivacyMaskingToUpstream，从而仍然覆盖「上游看到占位符 → 客户端拿到原文」。
 */
import express from "express";
import request from "supertest";
import type { Deployment } from "../types/router";
import { applyPrivacyMaskingToUpstream, PrivacyBlockedError } from "./PrivacyDispatch";
import { privacyMaskingMiddleware } from "./PrivacyMiddleware";
import { parsePrivacyMaskingSettings, privacySettingsService } from "./PrivacyConfig";
import { privacyScopeTargetOf } from "./PrivacyScope";
import type { PrivacyProtocol } from "./RequestBodyMasker";

const EMAIL = "jansen@liasece.com";
const API_KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz";

/** 假 Router 选中的 deployment：默认落在 opencode 上 */
const OPENCODE_DEPLOYMENT = {
	model_name: "opencode-go/deepseek-v4.1-flash",
	litellm_params: { custom_llm_provider: "cliproxy", model: "cliproxy/opencode-go/deepseek-v4.1-flash" },
} as unknown as Deployment;

const DEEPSEEK_DEPLOYMENT = {
	model_name: "deepseek-v4-flash",
	litellm_params: { custom_llm_provider: "deepseek", model: "deepseek/deepseek-v4-flash" },
} as unknown as Deployment;

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
 * 模拟 Router：在发往上游前按最终 deployment 脱敏，命中 block 时拒绝整条请求。
 * @param body - 上游请求体
 * @param protocol - 协议
 * @param deployment - 假 Router 选中的 deployment
 */
function maskForUpstream(body: Record<string, unknown>, protocol: PrivacyProtocol, deployment: Deployment = OPENCODE_DEPLOYMENT): void {
	applyPrivacyMaskingToUpstream(body, privacyScopeTargetOf(deployment), protocol);
}

/**
 * 按 privacy_blocked 的响应结构回写拒绝结果。
 * @param res - Express 响应
 * @param error - 调度点抛出的错误
 */
function replyBlocked(res: express.Response, error: PrivacyBlockedError): void {
	res.status(error.statusCode).json(error.toErrorBody());
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
		try {
			maskForUpstream(req.body as Record<string, unknown>, "chat");
		} catch (error) {
			if (error instanceof PrivacyBlockedError) {
				replyBlocked(res, error);
				return;
			}
			throw error;
		}
		const content = body.messages[0]?.content ?? "";
		// 模拟模型原样复述：上游看到的是占位符，客户端应拿回原文
		res.json({ id: "chatcmpl-1", choices: [{ index: 0, message: { role: "assistant", content: content }, finish_reason: "stop" }] });
	});
	router.post("/v1/messages", (req, res) => {
		const body = req.body as { messages: Array<{ content: string }> };
		maskForUpstream(req.body as Record<string, unknown>, "anthropic");
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
		maskForUpstream(req.body as Record<string, unknown>, "responses");
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
		expect(captured.events[0]?.["model"]).toBe("opencode-go/deepseek-v4.1-flash");
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
			maskForUpstream(req.body as Record<string, unknown>, "chat");
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
			maskForUpstream(req.body as Record<string, unknown>, "chat");
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

	it("按类型 block：请求被拒绝，上游收不到内容，统计记为 block", async () => {
		const captured: CapturedRows = { events: [], values: [] };
		privacySettingsService.setSnapshot(parsePrivacyMaskingSettings({ kinds: { EMAIL: "block" } }));
		const app = express();
		app.use(express.json());
		app.use((req, _res, next) => {
			req.auth = { api_key: "sk-test", token: "hashed-token" } as never;
			next();
		});
		const router = express.Router();
		const fakeRouter = { getAvailableDeployment: () => undefined, getDeployments: () => [] };
		router.use(privacyMaskingMiddleware({ router: fakeRouter as never, db: makeDb(captured) as never }));
		let upstreamCalled = false;
		router.post("/v1/chat/completions", (req, res) => {
			try {
				maskForUpstream(req.body as Record<string, unknown>, "chat");
			} catch (error) {
				if (error instanceof PrivacyBlockedError) {
					replyBlocked(res, error);
					return;
				}
				throw error;
			}
			upstreamCalled = true;
			res.json({ ok: true });
		});
		app.use(router);
		const response = await request(app)
			.post("/v1/chat/completions")
			.send({ model: "gpt-test", messages: [{ role: "user", content: `mail ${EMAIL}` }] })
			.expect(400);
		const body = response.body as { error: { type: string; kinds: string[] } };
		expect(body.error.type).toBe("privacy_blocked");
		expect(body.error.kinds).toEqual(["EMAIL"]);
		expect(upstreamCalled).toBe(false);
		await settle();
		expect(captured.events[0]?.["action"]).toBe("block");
		expect(JSON.stringify(captured)).not.toContain(EMAIL);
	});

	it("不在生效范围的提供方：请求体原样上行，也不写统计", async () => {
		const captured: CapturedRows = { events: [], values: [] };
		privacySettingsService.setSnapshot(parsePrivacyMaskingSettings({ providers: ["opencode"] }));
		const app = express();
		app.use(express.json());
		app.use((req, _res, next) => {
			req.auth = { api_key: "sk-test", token: "hashed-token" } as never;
			next();
		});
		const router = express.Router();
		const fakeRouter = { getAvailableDeployment: () => undefined, getDeployments: () => [] };
		router.use(privacyMaskingMiddleware({ router: fakeRouter as never, db: makeDb(captured) as never }));
		let seen = "";
		router.post("/v1/chat/completions", (req, res) => {
			maskForUpstream(req.body as Record<string, unknown>, "chat", DEEPSEEK_DEPLOYMENT);
			seen = (req.body as { messages: Array<{ content: string }> }).messages[0]?.content ?? "";
			res.json({ echoed: seen });
		});
		app.use(router);
		await request(app)
			.post("/v1/chat/completions")
			.send({ model: "gpt-test", messages: [{ role: "user", content: `mail ${EMAIL}` }] })
			.expect(200);
		expect(seen).toBe(`mail ${EMAIL}`);
		await settle();
		expect(captured.events).toHaveLength(0);
	});

	it("假值开关：上游看到的是同形态假值，客户端拿回原文", async () => {
		const captured: CapturedRows = { events: [], values: [] };
		privacySettingsService.setSnapshot(parsePrivacyMaskingSettings({ shape: true }));
		const app = express();
		app.use(express.json());
		app.use((req, _res, next) => {
			req.auth = { api_key: "sk-test", token: "hashed-token" } as never;
			next();
		});
		const router = express.Router();
		const fakeRouter = { getAvailableDeployment: () => undefined, getDeployments: () => [] };
		router.use(privacyMaskingMiddleware({ router: fakeRouter as never, db: makeDb(captured) as never }));
		let seen = "";
		router.post("/v1/chat/completions", (req, res) => {
			maskForUpstream(req.body as Record<string, unknown>, "chat");
			seen = (req.body as { messages: Array<{ content: string }> }).messages[0]?.content ?? "";
			res.json({ echoed: seen });
		});
		app.use(router);
		const response = await request(app)
			.post("/v1/chat/completions")
			.send({ model: "gpt-test", messages: [{ role: "user", content: `key ${API_KEY}` }] })
			.expect(200);
		expect(seen).not.toContain(API_KEY);
		expect(seen).not.toContain("{{");
		expect(seen).toMatch(/^key [A-Za-z0-9_-]{15,}$/);
		expect((response.body as { echoed: string }).echoed).toBe(`key ${API_KEY}`);
	});
});
