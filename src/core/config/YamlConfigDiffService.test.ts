/**
 * YamlConfigDiffService 单元测试
 *
 * 覆盖：
 * - 快照 hash：规范化 JSON 键序无关，yaml 内容变化 → hash 变化
 * - 四设置段字段级 diff（db_missing / value_differs / 深比较相等跳过 / DB 独有键忽略）
 * - model_list 三种情形（db_missing / params_differ / DB 独有模型不列冲突）
 * - initialize：快照一致无 pending；首次无快照 DB 空 → 直接存快照；首次无快照 DB 非空 → 全量 diff
 * - resolveSnapshot：存快照 + 清 pending
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, resetConfig } from "./index";
import {
	computeYamlConfigDiff,
	canonicalizeConfigValue,
	computeCurrentYamlSnapshot,
	YamlConfigDiffService,
	CONFIG_YAML_SNAPSHOT_PARAM,
	type YamlDiffSettingSection,
} from "./YamlConfigDiffService";
import { LiteLLM_ProxyModelTable } from "../../db/schema/proxyModels";
import type { ProxyModelRowLike } from "../../router/ProxyModelDeployment";

/**
 * 构造内存 mock db：LiteLLM_Config 与 LiteLLM_ProxyModelTable 两表
 * @param initialConfig
 * @param initialModels
 */
function makeMockDb(initialConfig: Record<string, unknown> = {}, initialModels: ProxyModelRowLike[] = []) {
	const store = new Map<string, unknown>(Object.entries(initialConfig));
	const selectRows = (table: unknown): Promise<unknown[]> => {
		if (table === LiteLLM_ProxyModelTable) {
			return Promise.resolve([...initialModels]);
		}
		const rows = Array.from(store, ([param_name, param_value]) => ({ param_name: param_name, param_value: param_value }));
		return Promise.resolve(rows);
	};
	const db = {
		select: () => ({
			from: (table: unknown) => {
				const promise = selectRows(table);
				return Object.assign(promise, {
					where: () => promise,
					limit: () => promise,
				});
			},
		}),
		insert: () => ({
			values: (row: { param_name: string; param_value: unknown }) => ({
				onConflictDoUpdate: () => {
					store.set(row.param_name, row.param_value);
					return Promise.resolve();
				},
			}),
		}),
	};
	return { db: db, store: store };
}

const EMPTY_SECTIONS: Record<YamlDiffSettingSection, Record<string, unknown>> = {
	general_settings: {},
	litellm_settings: {},
	router_settings: {},
	environment_variables: {},
};

/**
 * 写入临时 yaml 并通过 loadConfig 加载（设置 lastRawYaml）
 * @param content
 */
function loadYamlFromString(content: string): void {
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yaml-diff-")), "config.yaml");
	fs.writeFileSync(file, content);
	process.env.CONFIG_PATH = file;
	resetConfig();
	loadConfig();
}

afterEach(() => {
	resetConfig();
	delete process.env.CONFIG_PATH;
});

describe("canonicalizeConfigValue", () => {
	it("键序不同但语义相同的对象应得到相同字符串", () => {
		expect(canonicalizeConfigValue({ a: 1, b: { c: 2, d: [3] } })).toBe(canonicalizeConfigValue({ b: { d: [3], c: 2 }, a: 1 }));
	});

	it("yaml 内容变化应导致快照 hash 变化", () => {
		loadYamlFromString("general_settings:\n  master_key: sk-a\n");
		const first = computeCurrentYamlSnapshot();
		loadYamlFromString("general_settings:\n  master_key: sk-b\n");
		const second = computeCurrentYamlSnapshot();
		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(first!.hash).not.toBe(second!.hash);
	});

	it("键序重排不应改变快照 hash", () => {
		loadYamlFromString("general_settings:\n  a: 1\n  b: 2\n");
		const first = computeCurrentYamlSnapshot();
		loadYamlFromString("general_settings:\n  b: 2\n  a: 1\n");
		const second = computeCurrentYamlSnapshot();
		expect(first!.hash).toBe(second!.hash);
	});
});

describe("computeYamlConfigDiff", () => {
	it("设置段：DB 缺失字段 → db_missing；值不同 → value_differs；深比较相等跳过；DB 独有键忽略", () => {
		const rawYaml = {
			general_settings: { master_key: "sk-yaml", ui_access_mode: "all", same: { x: [1, 2] } },
			router_settings: { fallbacks: [{ a: ["b"] }] },
		};
		const dbSections: Record<YamlDiffSettingSection, Record<string, unknown>> = {
			...EMPTY_SECTIONS,
			general_settings: { same: { x: [1, 2] }, db_only_key: "keep" },
		};
		const items = computeYamlConfigDiff(rawYaml, dbSections, []);
		expect(items).toEqual([
			{ section: "general_settings", key: "master_key", yaml_value: "sk-yaml", db_value: null, diff_kind: "db_missing" },
			{ section: "general_settings", key: "ui_access_mode", yaml_value: "all", db_value: null, diff_kind: "db_missing" },
			{
				section: "router_settings",
				key: "fallbacks",
				yaml_value: [{ a: ["b"] }],
				db_value: null,
				diff_kind: "db_missing",
			},
		]);
	});

	it("设置段：字段两侧都有但值不同 → value_differs", () => {
		const rawYaml = { litellm_settings: { callbacks: ["a"] } };
		const dbSections: Record<YamlDiffSettingSection, Record<string, unknown>> = {
			...EMPTY_SECTIONS,
			litellm_settings: { callbacks: ["b"] },
		};
		const items = computeYamlConfigDiff(rawYaml, dbSections, []);
		expect(items).toEqual([
			{ section: "litellm_settings", key: "callbacks", yaml_value: ["a"], db_value: ["b"], diff_kind: "value_differs" },
		]);
	});

	it("model_list：yaml 有 DB 无 → db_missing；参数不同 → params_differ；DB 有 yaml 无不列冲突", () => {
		const rawYaml = {
			model_list: [
				{ model_name: "yaml-only", litellm_params: { model: "anthropic/a" } },
				{ model_name: "both", litellm_params: { model: "anthropic/b" }, model_info: { mode: "chat" } },
				{ model_name: "same", litellm_params: { model: "anthropic/c" } },
			],
		};
		const dbModels: ProxyModelRowLike[] = [
			{
				model_id: "id-both",
				model_name: "both",
				litellm_params: { model: "anthropic/b-changed" },
				model_info: { id: "id-both", db_model: true, mode: "chat" },
			},
			{
				model_id: "id-same",
				model_name: "same",
				litellm_params: { model: "anthropic/c" },
				model_info: { id: "id-same", db_model: true },
			},
			{ model_id: "id-web", model_name: "web-added", litellm_params: { model: "openai/gpt" }, model_info: {} },
		];
		const items = computeYamlConfigDiff(rawYaml, EMPTY_SECTIONS, dbModels);
		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({ section: "model_list", key: "yaml-only", diff_kind: "db_missing", db_value: null });
		expect(items[1]).toMatchObject({
			section: "model_list",
			key: "both",
			diff_kind: "params_differ",
			db_value: { model_id: "id-both" },
		});
		// same 参数一致不列出；web-added 仅 DB 有不列冲突
		expect(items.find((i) => i.key === "same")).toBeUndefined();
		expect(items.find((i) => i.key === "web-added")).toBeUndefined();
	});

	it("model_list：仅注入字段 id/db_model 差异不视为 params_differ", () => {
		const rawYaml = {
			model_list: [{ model_name: "m", litellm_params: { model: "anthropic/m" }, model_info: { mode: "chat" } }],
		};
		const dbModels: ProxyModelRowLike[] = [
			{
				model_id: "id-m",
				model_name: "m",
				litellm_params: { model: "anthropic/m" },
				model_info: { id: "id-m", db_model: true, mode: "chat" },
			},
		];
		expect(computeYamlConfigDiff(rawYaml, EMPTY_SECTIONS, dbModels)).toEqual([]);
	});
});

describe("YamlConfigDiffService.initialize", () => {
	it("快照 hash 一致 → 无 pending", async () => {
		loadYamlFromString("general_settings:\n  master_key: sk-yaml\n");
		const current = computeCurrentYamlSnapshot()!;
		const { db } = makeMockDb({ [CONFIG_YAML_SNAPSHOT_PARAM]: { hash: current.hash, content: current.content } });
		const service = new YamlConfigDiffService();
		await service.initialize(db as never);
		expect(service.hasPending()).toBe(false);
	});

	it("首次运行（无快照）且 DB 四段+模型表全空 → 直接存快照，无 pending", async () => {
		loadYamlFromString("general_settings:\n  master_key: sk-yaml\n");
		const { db, store } = makeMockDb();
		const service = new YamlConfigDiffService();
		await service.initialize(db as never);
		expect(service.hasPending()).toBe(false);
		const snapshot = store.get(CONFIG_YAML_SNAPSHOT_PARAM) as { hash: string; updated_at: string };
		expect(snapshot).toBeDefined();
		expect(snapshot.hash).toBe(computeCurrentYamlSnapshot()!.hash);
		expect(typeof snapshot.updated_at).toBe("string");
	});

	it("首次运行（无快照）但 DB 非空 → 全量 diff 进 pending，不写快照", async () => {
		loadYamlFromString("general_settings:\n  master_key: sk-yaml\n");
		const { db, store } = makeMockDb({ general_settings: { master_key: "sk-db" } });
		const service = new YamlConfigDiffService();
		await service.initialize(db as never);
		expect(store.has(CONFIG_YAML_SNAPSHOT_PARAM)).toBe(false);
		expect(service.hasPending()).toBe(true);
		expect(service.getPendingItems()).toEqual([
			{ section: "general_settings", key: "master_key", yaml_value: "sk-yaml", db_value: "sk-db", diff_kind: "value_differs" },
		]);
	});

	it("快照 hash 不一致 → 重新全量 diff", async () => {
		loadYamlFromString("general_settings:\n  ui_access_mode: all\n");
		const { db } = makeMockDb({ [CONFIG_YAML_SNAPSHOT_PARAM]: { hash: "stale-hash", content: "{}" } });
		const service = new YamlConfigDiffService();
		await service.initialize(db as never);
		expect(service.getPendingItems()).toEqual([
			{ section: "general_settings", key: "ui_access_mode", yaml_value: "all", db_value: null, diff_kind: "db_missing" },
		]);
	});
});

describe("YamlConfigDiffService pending 操作", () => {
	it("removePendingItem 移除指定项", async () => {
		loadYamlFromString("general_settings:\n  a: 1\n  b: 2\n");
		const { db } = makeMockDb({ [CONFIG_YAML_SNAPSHOT_PARAM]: { hash: "stale", content: "{}" } });
		const service = new YamlConfigDiffService();
		await service.initialize(db as never);
		expect(service.getPendingItems()).toHaveLength(2);
		expect(service.removePendingItem("general_settings", "a")).toBe(true);
		expect(service.getPendingItems().map((i) => i.key)).toEqual(["b"]);
		expect(service.removePendingItem("general_settings", "a")).toBe(false);
	});

	it("resolveSnapshot 存当前快照并清空 pending", async () => {
		loadYamlFromString("general_settings:\n  a: 1\n");
		const { db, store } = makeMockDb({ [CONFIG_YAML_SNAPSHOT_PARAM]: { hash: "stale", content: "{}" } });
		const service = new YamlConfigDiffService();
		await service.initialize(db as never);
		expect(service.hasPending()).toBe(true);
		const snapshot = await service.resolveSnapshot(db as never);
		expect(snapshot).not.toBeNull();
		expect(snapshot!.hash).toBe(computeCurrentYamlSnapshot()!.hash);
		expect(service.hasPending()).toBe(false);
		const stored = store.get(CONFIG_YAML_SNAPSHOT_PARAM) as { hash: string };
		expect(stored.hash).toBe(snapshot!.hash);
	});
});
