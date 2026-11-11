import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Request } from "express";
import { Pool } from "pg";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import * as schema from "../db/schema";
import type { Router } from "../router/Router";
import { createImageCompletionHistory, type ImageCompletionExecution } from "./ImageCompletionHistory";
import { prepareAnthropicImageGenerationRequest, prepareOpenAIImageGenerationRequest } from "./ImageGenerationCapability";
import type { HistoryMessage, ImageHistoryProtocol } from "./ImageCompletionTranscript";
import { MemoryVisionImageStore } from "./VisionImageStore";

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite("跨请求恢复内置生图历史", () => {
	let pool: Pool;
	let db: ReturnType<typeof drizzle<typeof schema>>;
	const schemaName = `img_history_${process.pid}_${Date.now()}`;
	const store = new MemoryVisionImageStore();
	const user = (content: string) => ({ role: "user", content });
	const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGqMAAAAASUVORK5CYII=";
	const scopeId = randomUUID();
	const unique = () => `imggen_${randomUUID().replaceAll("-", "")}`;
	const history = (messages: HistoryMessage[], protocol: ImageHistoryProtocol, owner = "fixture-account", key?: string) =>
		createImageCompletionHistory(
			db,
			{
				auth: { api_key: owner },
				headers: { "idempotency-key": key },
				body: { model: "fixture", metadata: { user_id: JSON.stringify({ session_id: scopeId }) }, messages },
			} as unknown as Request,
			protocol,
			messages,
		)!;
	async function generated(id: string): Promise<ImageCompletionExecution> {
		const asset = await store.put({ mediaType: "image/png", base64Data: png });
		return {
			raw: { cost: 1 },
			model: "worker",
			images: [
				{
					id,
					ref: asset.ref,
					action: "create",
					mediaType: "image/png",
					outputFormat: "png",
					b64Json: png,
					prompt: "original private prompt",
					model: "worker",
				},
			],
		};
	}

	beforeAll(async () => {
		pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schemaName}` });
		await pool.query(`CREATE SCHEMA "${schemaName}"`);
		const migration = readFileSync(resolve(__dirname, "../../drizzle/0015_image_completion_history.sql"), "utf8");
		for (const statement of migration.split("--> statement-breakpoint")) await pool.query(statement);
		db = drizzle(pool, { schema });
	});
	afterAll(async () => {
		if (pool) {
			await pool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
			await pool.end();
		}
	});
	afterEach(() => jest.restoreAllMocks());

	test("缓存命中边界包含已经恢复的回执，后续消息只延长真实的上游投影", async () => {
		jest.spyOn(dbConfigProvider, "getParam").mockResolvedValue({
			image_generation: { enabled: true, always_inject: true, handler_model: "worker" },
		});
		const router = {
			getDeployments: () => [{ model_name: "fixture", model_info: { enabled_builtin_capabilities: ["image_generation"] } }],
		} as unknown as Router;
		for (const protocol of ["chat", "anthropic"] as const) {
			const first = [user("Draw a cache test tile for " + protocol)];
			const publicReply = { role: "assistant", content: "Created the tile." };
			const h = history(first, protocol);
			await h.execute("real-private-call", "create", "tile", store, () => generated(unique()));
			await h.bind(publicReply);
			const second = [...first, publicReply, user("Check the result")];
			const third = [...second, { role: "assistant", content: "Checked." }, user("Summarize")];
			const prepare = async (input: HistoryMessage[]) => {
				const messages = await history(input, protocol).restore();
				if (protocol === "anthropic") {
					const prepared = await prepareAnthropicImageGenerationRequest(
						router,
						"fixture",
						{ system: "original system", messages },
						store,
					);
					expect(prepared!.body.system).toBe("original system");
					return { prefix: [prepared!.body.system, prepared!.body.tools], messages: prepared!.messages };
				}
				const prepared = await prepareOpenAIImageGenerationRequest(router, "fixture", messages, store);
				return { prefix: [], messages: prepared!.messages };
			};
			const previous = await prepare(second);
			const next = await prepare(third);
			expect(next.prefix).toEqual(previous.prefix);
			expect(next.messages.slice(0, previous.messages.length)).toEqual(previous.messages);
		}
	});

	test("公开工具批次全部回执后可见，第三轮逐项保留第二轮上游前缀且下游原文不变", async () => {
		const first = [user("Draw a tile")];
		const id = unique();
		const h = history(first, "anthropic");
		await h.execute("private-1", "create", "draw", store, () => generated(id));
		const publicCall = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "signed", signature: "original-signature" },
				{ type: "tool_use", id: "send-1", name: "send", input: { expected: 1 } },
				{ type: "tool_use", id: "info-2", name: "info", input: {} },
			],
		};
		await h.bind(publicCall);
		const result = (toolId: string) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: toolId, content: "accepted" }] });
		const partial = [...first, publicCall, result("send-1")];
		expect(await history(partial, "anthropic").restore()).toEqual(partial);
		const second = [...partial, result("info-2")];
		const asSent = structuredClone(second);
		const upstream = await history(second, "anthropic").restore();
		expect(upstream.slice(0, second.length)).toEqual(asSent);
		expect(JSON.stringify(upstream.at(-1))).toContain(id);
		expect(JSON.stringify(upstream.at(-1))).not.toContain(png);
		const third = [...second, { role: "assistant", content: "Verified" }, user("Continue")];
		const later = await history(third, "anthropic").restore();
		expect(later.slice(0, upstream.length)).toEqual(upstream);
		expect(later.slice(upstream.length)).toEqual(third.slice(second.length));
		expect(second).toEqual(asSent);
		expect(await history(second, "anthropic", "other-account").restore()).toEqual(second);
		const branch = [user("Different task"), ...second.slice(1)];
		expect(await history(branch, "anthropic").restore()).toEqual(branch);
	});

	test("同一会话内文字相同的不同分支不能相互取图，同一公开前缀多解时保持未知", async () => {
		const first = [user("Draw a boat")];
		const assistant = { role: "assistant", content: '{"ok":true}' };
		const id = unique();
		const h = history(first, "chat");
		await h.execute("private-a", "create", "boat", store, () => generated(id));
		await h.bind(assistant);
		const replay = [...first, assistant, user("What did you make?")];
		expect(JSON.stringify(await history(replay, "chat").restore())).toContain(id);
		const other = [user("Draw a bird"), ...replay.slice(1)];
		expect(await history(other, "chat").restore()).toEqual(other);
		const competing = history(first, "chat");
		await competing.execute("private-b", "create", "boat", store, () => generated(unique()));
		await competing.bind(assistant);
		expect(await history(replay, "chat").restore()).toEqual(replay);
	});

	test("Codex 原生图片匹配同一产物，拒绝冲突字节，严格区分公开函数和已完成图片", async () => {
		const id = unique();
		const input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "Make a tile" }] }];
		const h = history(input, "responses");
		await h.execute("original", "create", "tile", store, () => generated(id));
		const fn = { type: "function_call", call_id: "public-read", name: "read", arguments: "{}" };
		const item = { type: "image_generation_call", status: "completed", id, result: png };
		await h.bind([fn, item]);
		const result = { type: "function_call_output", call_id: "public-read", output: "ok" };
		const replay = [...input, fn, item, result];
		const model = await history(replay, "responses").restore();
		expect(model.slice(0, 3)).toEqual([...input, fn, result]);
		expect(JSON.stringify(model.at(-1))).toContain(`sha256:${createHash("sha256").update(Buffer.from(png, "base64")).digest("hex")}`);
		expect(JSON.stringify(model)).not.toContain(png);
		await expect(history([...input, fn, { ...item, result: "YmFk" }, result], "responses").restore()).rejects.toThrow("does not match");
		expect(await history(replay, "responses", "other-account").restore()).toEqual(replay);
	});

	test("只恢复当前公开工具续轮中已付款的输出槽；附件、其他用户和未完成配对不占新槽", async () => {
		const input = [user("Draw two different tiles, then check the files")];
		const fn = (id: string, name: string, args: Record<string, unknown>) => ({
			type: "function_call",
			call_id: id,
			name,
			arguments: JSON.stringify(args),
		});
		const out = (id: string, output: string) => ({ type: "function_call_output", call_id: id, output });
		const call = fn("list", "bash", { command: "ls -la; find . -name '*.png' | head -5" });
		const first = history(input, "responses");
		const id = unique();
		await first.execute("private-tile", "create", "tile", store, () => generated(id), 2, 2);
		await first.bind([call]);
		const second = [...input, call, out("list", "image.png")];
		const inspect = async (messages: HistoryMessage[], owner?: string) => {
			const h = history(messages, "responses", owner);
			const model = await h.restore();
			return { assets: h.continuingAssets, model };
		};
		const projected = await inspect(second);
		expect(projected.assets).toMatchObject([{ id, target: { index: 2, count: 2 } }]);
		expect(JSON.stringify(projected.model.at(-1))).toContain("output 2/2");
		const read = fn("read-check", "read", { path: "receipt-check.txt" });
		const third = [...second, read, out("read-check", "verified")];
		expect((await inspect(third)).model.slice(0, projected.model.length)).toEqual(projected.model);
		expect((await inspect(third)).assets).toEqual(projected.assets);
		for (const branch of [
			[...second, user("Draw a new one"), read, out("read-check", "verified")],
			[...second, read],
			[...second, fn("new", "next_ticket", {}), out("new", "same filename")],
			[...second, fn("remote", "bash", { command: "ls -l; curl https://example.test/task" }), out("remote", "task text")],
			[...second, read, out("read-check", '{"workItem":{"id":"new-job"}}')],
			[
				...input,
				{ type: "image_generation_call", status: "completed", id },
				fn("other", "read", { path: "check.txt" }),
				out("other", "exists"),
			],
		]) {
			expect((await inspect(branch)).assets).toEqual([]);
		}
		expect((await inspect(third, "other-tenant")).assets).toEqual([]);
		const other = history(input, "responses");
		await other.execute("racing", "create", "another tile", store, () => generated(unique()), 1, 1);
		await other.bind([call]);
		expect((await inspect(third)).assets).toEqual([]);
	});

	test.each(["work_next", "mcp__company__work_current"])(
		"%s 返回同一工单和用户指令时可续取；换工单、版本、指令或空队列不复用旧槽",
		async (workTool) => {
			const task = [user("Draw one tile for each distinct queue item")];
			const fetchWork = (id: string) => ({ type: "function_call", call_id: id, name: workTool, arguments: "{}" });
			const item = (id: string, version: number, messageId: string, text: string) => ({
				workItem: { id, inputVersion: version, title: "Draw", prompt: "Draw a tile" },
				messages: [{ id: messageId, workId: id, role: "user", content: text }],
			});
			const output = (id: string, value: unknown) => ({ type: "function_call_output", call_id: id, output: JSON.stringify(value) });
			const job = item("A", 1, "m1", "one blue tile");
			const first = [...task, fetchWork("first"), output("first", job)];
			const h = history(first, "responses");
			const id = unique();
			await h.execute("private-a", "create", "tile", store, () => generated(id), 1, 1);
			await h.bind([fetchWork("again")]);
			const next = async (value: unknown) => {
				const q = history([...first, fetchWork("again"), output("again", value)], "responses");
				const projected = await q.restore();
				expect(JSON.stringify(projected)).toContain(id);
				return q.continuingAssets;
			};
			expect(await next(job)).toMatchObject([{ id, target: { index: 1, count: 1 } }]);
			expect(await next({ ...job, messages: [] })).toHaveLength(1);
			for (const fresh of [
				item("B", 1, "m2", "two blue tiles"),
				item("A", 2, "m1", "one blue tile"),
				item("A", 1, "m2", "one blue tile"),
				item("A", 1, "m1", "a different image"),
				{ status: "empty", workItem: null, messages: [] },
			]) {
				expect(await next(fresh)).toEqual([]);
			}
		},
	);

	test("旧回执不猜目标；Anthropic 同一 user 块中附有新指令不能继承槽", async () => {
		const input = [user("Draw one")];
		const use = { role: "assistant", content: [{ type: "tool_use", id: "check", name: "Read", input: { file_path: "check.txt" } }] };
		const result = { type: "tool_result", tool_use_id: "check", content: "checked" };
		for (const hasPlan of [false, true]) {
			const owner = hasPlan ? "with-plan" : "without-plan";
			const id = unique();
			const h = history(input, "anthropic", owner);
			await h.execute("private", "create", "draw", store, () => generated(id), 1, hasPlan ? 1 : undefined);
			await h.bind(use);
			for (const mixed of [false, true]) {
				const next = history(
					[
						...input,
						use,
						{ role: "user", content: mixed ? [result, { type: "text", text: "Please draw another image" }] : [result] },
					],
					"anthropic",
					owner,
				);
				expect(JSON.stringify(await next.restore())).toContain(id);
				expect(next.continuingAssets).toHaveLength(hasPlan && !mixed ? 1 : 0);
			}
		}
	});

	test("并发占用同一幂等键只允许一次付费执行，后续重取使用原图 ID 和字节", async () => {
		const first = [user("Draw exactly one")];
		const id = unique();
		let begin!: () => void;
		let finish!: () => void;
		const started = new Promise<void>((done) => {
			begin = done;
		});
		const release = new Promise<void>((done) => {
			finish = done;
		});
		const worker = jest.fn(async () => {
			begin();
			await release;
			return generated(id);
		});
		const run = (messages: HistoryMessage[], callId: string) =>
			history(messages, "chat", "retry-account", "stable-key").execute(callId, "create", "draw", store, worker);
		const pending = run(first, "first-call");
		await started;
		await expect(run(first, "parallel")).rejects.toMatchObject({ statusCode: 409 });
		finish();
		await pending;
		const repeated = await run(first, "model-authored-another-id");
		expect(repeated.images[0]).toMatchObject({ id, b64Json: png });
		expect(repeated.raw).toEqual({});
		await expect(run([user("different task")], "conflict")).rejects.toMatchObject({ statusCode: 409 });
		expect(worker).toHaveBeenCalledTimes(1);
	});
});
