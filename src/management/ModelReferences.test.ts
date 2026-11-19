/**
 * ModelReferences 纯逻辑测试 — 审计与改名级联。
 *
 * 覆盖生产事故的两类缺陷：引用悬空检测（fallback 键/目标、alias 目标、密钥白名单、
 * 环）与改名计划的重写完整性（形态保持、只动目标名字）。哨兵 all-team-models 不算悬空。
 */
import { auditModelReferences, planModelReferenceRename, type ModelReferenceState } from "./ModelReferences";

function state(overrides: Partial<ModelReferenceState> = {}): ModelReferenceState {
	return {
		groups: ["commandcode/deepseek-v4.1-flash", "opencode-go/deepseek-v4.1-flash"],
		rows: [
			{
				modelId: "model-1",
				modelName: "commandcode/deepseek-v4.1-flash",
				modelInfo: { fallbacks: ["opencode-go/deepseek-v4.1-flash"] },
			},
		],
		routerSettings: {
			fallbacks: [{ "commandcode/deepseek-v4.1-flash": ["opencode-go/deepseek-v4.1-flash"] }],
			model_group_alias: { "deepseek-v4-flash": "commandcode/deepseek-v4.1-flash" },
		},
		generalSettings: {},
		capabilities: {},
		teams: [{ teamId: "team-1", models: ["commandcode/deepseek-v4.1-flash"] }],
		tokens: [
			{ tokenId: "key-a", models: ["commandcode/deepseek-v4.1-flash", "all-team-models"] },
			{ tokenId: "key-b", models: ["commandcode/deepseek/deepseek-v4.1-flash"] },
		],
		permissions: [{ permissionId: "perm-1", models: ["deepseek-v4-flash"] }],
		...overrides,
	};
}

describe("auditModelReferences", () => {
	it("把密钥白名单里的死名判为悬空，哨兵不算", () => {
		const audit = auditModelReferences(state());
		expect(audit.liveNames).toContain("deepseek-v4-flash");
		expect(audit.dangling).toEqual([
			{ surface: "VerificationToken.models", path: "key-b", name: "commandcode/deepseek/deepseek-v4.1-flash" },
		]);
	});

	it("fallback 键与目标、alias 目标悬空都报出来", () => {
		const audit = auditModelReferences(
			state({
				groups: ["model-a"],
				rows: [{ modelId: "m", modelName: "model-a", modelInfo: {} }],
				routerSettings: {
					fallbacks: [{ "model-a": ["gone-model"] }, { "gone-source": ["model-a"] }],
					model_group_alias: { "alias-x": "gone-model" },
				},
				tokens: [],
				teams: [],
				permissions: [],
			}),
		);
		expect(audit.dangling.map((item) => `${item.surface}:${item.path}=${item.name}`).sort()).toEqual([
			"model_group_alias:alias-x=gone-model",
			"router_settings.fallbacks:gone-source=gone-source",
			"router_settings.fallbacks:model-a=gone-model",
		]);
	});

	it("alias 目标成环判为悬空", () => {
		const audit = auditModelReferences(
			state({
				groups: ["model-a"],
				rows: [{ modelId: "m", modelName: "model-a", modelInfo: {} }],
				routerSettings: { model_group_alias: { "alias-a": "alias-b", "alias-b": "alias-a" } },
				tokens: [],
				teams: [],
				permissions: [],
			}),
		);
		expect(
			audit.dangling
				.filter((item) => item.surface === "model_group_alias_cycle")
				.map((item) => item.path)
				.sort(),
		).toEqual(["alias-a", "alias-b"]);
	});
});

describe("planModelReferenceRename", () => {
	it("组名善后：重写 fallback 目标、alias 目标、密钥白名单并保持 recurse 形态", () => {
		const before = state({
			routerSettings: {
				fallbacks: [{ "old-name": { targets: ["opencode-go/deepseek-v4.1-flash"], recurse: false } }],
				model_group_alias: { "deepseek-v4-flash": "old-name" },
			},
			groups: ["old-name", "opencode-go/deepseek-v4.1-flash"],
			tokens: [{ tokenId: "key-b", models: ["old-name"] }],
			teams: [],
			permissions: [],
		});
		const changes = planModelReferenceRename(before, "old-name", "commandcode/deepseek-v4.1-flash");
		expect(changes.routerSettings).toMatchObject({
			fallbacks: [{ "commandcode/deepseek-v4.1-flash": { targets: ["opencode-go/deepseek-v4.1-flash"], recurse: false } }],
			model_group_alias: { "deepseek-v4-flash": "commandcode/deepseek-v4.1-flash" },
		});
		expect(changes.tokens).toEqual([{ tokenId: "key-b", models: ["commandcode/deepseek-v4.1-flash"] }]);
		expect(changes.counts).toContainEqual({ surface: "router_settings.fallbacks", rewritten: 1 });
		expect(changes.counts).toContainEqual({ surface: "model_group_alias", rewritten: 1 });
	});

	it("别名改名：连同别名键一起改写，目标名字不受影响", () => {
		const before = state({
			routerSettings: {
				fallbacks: [{ "old-alias": ["opencode-go/deepseek-v4.1-flash"] }],
				model_group_alias: { "old-alias": "commandcode/deepseek-v4.1-flash" },
			},
			teams: [{ teamId: "team-1", models: ["old-alias"] }],
			tokens: [],
			permissions: [],
		});
		const changes = planModelReferenceRename(before, "old-alias", "new-alias", true);
		expect(changes.routerSettings).toMatchObject({
			fallbacks: [{ "new-alias": ["opencode-go/deepseek-v4.1-flash"] }],
			model_group_alias: { "new-alias": "commandcode/deepseek-v4.1-flash" },
		});
		expect(changes.teams).toEqual([{ teamId: "team-1", models: ["new-alias"] }]);
	});

	it("模型行自身的 override 与 fallbacks、websearch 与能力执行模型一并重写", () => {
		const before = state({
			groups: ["target-group"],
			rows: [
				{
					modelId: "row-1",
					modelName: "row-one",
					modelInfo: { override_model_name: "old-name", fallbacks: ["old-name"], tier: "paid" },
				},
			],
			generalSettings: { websearch_override_target_model: "old-name" },
			capabilities: { web: { executors: [{ model: "old-name", type: "builtin" }, { model: "target-group" }] } },
			routerSettings: {},
			tokens: [],
			teams: [],
			permissions: [],
		});
		const changes = planModelReferenceRename(before, "old-name", "target-group");
		expect(changes.rows).toEqual([
			{ modelId: "row-1", modelInfo: { override_model_name: "target-group", fallbacks: ["target-group"], tier: "paid" } },
		]);
		expect(changes.generalSettings).toEqual({ websearch_override_target_model: "target-group" });
		expect(changes.capabilities).toEqual({
			web: { executors: [{ model: "target-group", type: "builtin" }, { model: "target-group" }] },
		});
		expect(changes.counts).toContainEqual({ surface: "model_info", rewritten: 2 });
		expect(changes.counts).toContainEqual({ surface: "builtin_capabilities", rewritten: 1 });
	});

	it("没有引用时不产生任何变更", () => {
		const before = state();
		const changes = planModelReferenceRename(before, "unreferenced-old", "opencode-go/deepseek-v4.1-flash");
		expect(changes.routerSettings).toBeUndefined();
		expect(changes.rows).toEqual([]);
		expect(changes.teams).toEqual([]);
		expect(changes.tokens).toEqual([]);
		expect(changes.permissions).toEqual([]);
		expect(changes.counts).toEqual([]);
	});
});
