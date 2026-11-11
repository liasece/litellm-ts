import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiError } from "../../../core/api/ApiError";
import { clearStaticCatalogCache, defaultStaticCatalogPath, staticCatalogForSource } from "./staticCatalog";

/** 写一份临时目录文件并返回路径。 */
async function writeCatalogFile(entries: unknown): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), "subscription-catalog-"));
	const filePath = path.join(directory, "subscription-models.json");
	await writeFile(filePath, typeof entries === "string" ? entries : JSON.stringify(entries), "utf8");
	return filePath;
}

/** 删除临时目录树。 */
async function removeCatalogFile(filePath: string): Promise<void> {
	await rm(path.dirname(filePath), { recursive: true, force: true });
}

afterEach(() => {
	clearStaticCatalogCache();
});

describe("静态订阅模型目录", () => {
	it("把 codex 四个套餐键合并为一份目录并按 id 去重", () => {
		const models = staticCatalogForSource("codex");
		const ids = models.map((model) => model.id);

		expect(ids).toHaveLength(9);
		expect(ids[0]).toBe("gpt-6-luna");
		expect(new Set(ids).size).toBe(ids.length);
		expect(models.find((model) => model.id === "gpt-6-astra")).toMatchObject({
			upstreamId: "gpt-6-astra",
			displayName: "GPT 6.0 Astra",
			protocol: "responses",
			metadata: expect.objectContaining({
				type: "openai",
				contextLength: 272000,
				maxOutputTokens: 128000,
				catalogKeys: ["codex-team", "codex-plus", "codex-pro"],
			}),
		});
	});

	it("按来源过滤五家静态目录并映射 id / 展示名 / 类型 / 上下文", () => {
		const claude = staticCatalogForSource("claude");
		expect(claude).toHaveLength(19);
		expect(claude[0]).toMatchObject({
			id: "claude-haiku-4-5-20251001",
			upstreamId: "claude-haiku-4-5-20251001",
			displayName: "Claude 4.5 Haiku",
			protocol: "messages",
			metadata: expect.objectContaining({ type: "claude", ownedBy: "anthropic", contextLength: 200000, catalogKeys: ["claude"] }),
		});

		expect(staticCatalogForSource("kimi")[0]).toMatchObject({ id: "kimi-k2", protocol: "chat", metadata: expect.objectContaining({ type: "kimi" }) });
		expect(staticCatalogForSource("antigravity")[0]).toMatchObject({
			id: "claude-opus-4-6-thinking",
			protocol: "gemini",
			metadata: expect.objectContaining({ type: "antigravity", contextLength: 200000 }),
		});
		expect(staticCatalogForSource("xai")[0]).toMatchObject({
			id: "grok-4.7",
			protocol: "responses",
			metadata: expect.objectContaining({ type: "xai", contextLength: 500000 }),
		});
	});

	it("动态来源没有静态键，返回空目录", () => {
		expect(staticCatalogForSource("commandcode")).toEqual([]);
		expect(staticCatalogForSource("opencode-go")).toEqual([]);
	});

	it("缓存同一路径的结果，清空缓存后重新读取文件", async () => {
		const filePath = await writeCatalogFile({
			claude: [{ id: "claude-first", display_name: "First", type: "claude", context_length: 1000 }],
		});
		try {
			const first = staticCatalogForSource("claude", { filePath: filePath });
			expect(first.map((model) => model.id)).toEqual(["claude-first"]);
			await writeFile(filePath, JSON.stringify({ claude: [{ id: "claude-second" }] }), "utf8");

			expect(staticCatalogForSource("claude", { filePath: filePath })).toBe(first);
			clearStaticCatalogCache();
			expect(staticCatalogForSource("claude", { filePath: filePath }).map((model) => model.id)).toEqual(["claude-second"]);
		} finally {
			await removeCatalogFile(filePath);
		}
	});

	it("临时目录：忽略未知键与无效条目，保留 codex 合并语义", async () => {
		const filePath = await writeCatalogFile({
			"codex-free": [{ id: "shared-model", display_name: "Shared", type: "openai", context_length: 100 }],
			"codex-team": [
				{ id: "shared-model", display_name: "Shared", type: "openai", context_length: 100 },
				{ id: "team-only", display_name: "Team Only" },
				{ name: "legacy-name-only" },
			],
			"codex-plus": [{ display_name: "no id" }, "opaque", { id: "   " }],
			kimi: [{ id: "kimi-custom", context_length: "131072" }],
			mystery: [{ id: "not-mapped" }],
		});
		try {
			const codex = staticCatalogForSource("codex", { filePath: filePath });
			expect(codex.map((model) => model.id)).toEqual(["shared-model", "team-only", "legacy-name-only"]);
			expect(codex[0]).toMatchObject({
				displayName: "Shared",
				metadata: expect.objectContaining({ catalogKeys: ["codex-free", "codex-team"], contextLength: 100 }),
			});
			expect(codex[1]).toMatchObject({ displayName: "Team Only", metadata: expect.objectContaining({ catalogKeys: ["codex-team"] }) });
			expect(codex[2]).toMatchObject({ displayName: "legacy-name-only", upstreamId: "legacy-name-only" });

			const kimi = staticCatalogForSource("kimi", { filePath: filePath });
			expect(kimi).toHaveLength(1);
			expect(kimi[0]).toMatchObject({ id: "kimi-custom", displayName: "kimi-custom", protocol: "chat", metadata: expect.objectContaining({ contextLength: 131072 }) });
		} finally {
			await removeCatalogFile(filePath);
		}
	});

	it("文件缺失或格式无效时给出可诊断的错误", async () => {
		const missing = path.join(tmpdir(), "definitely-missing-subscription-models.json");
		expect(() => staticCatalogForSource("claude", { filePath: missing })).toThrow(ApiError);
		expect(() => staticCatalogForSource("claude", { filePath: missing })).toThrow("静态订阅模型目录读取失败");

		const invalid = await writeCatalogFile("{not json");
		try {
			expect(() => staticCatalogForSource("claude", { filePath: invalid })).toThrow("静态订阅模型目录读取失败");
		} finally {
			await removeCatalogFile(invalid);
		}

		const notObject = await writeCatalogFile("[]");
		try {
			expect(() => staticCatalogForSource("claude", { filePath: notObject })).toThrow("静态订阅模型目录格式无效");
		} finally {
			await removeCatalogFile(notObject);
		}
	});

	it("默认路径指向随包的 data 目录", () => {
		expect(defaultStaticCatalogPath().endsWith(path.join("data", "subscription-models.json"))).toBe(true);
	});
});
