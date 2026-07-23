import baseline from "./python-schema-baseline.json";
import { compareSchemaSnapshots, validateRuntimeSchemaContract, type SchemaSnapshot } from "./SchemaPreflight";

const compatible: SchemaSnapshot = {
	source: "fixture",
	tables: [
		{
			name: "LiteLLM_Fixture",
			columns: [
				{ name: "id", type: "text", nullable: false, default: "(gen_random_uuid())::text" },
				{ name: "spend", type: "double precision", nullable: false, default: "0" },
			],
			constraints: [
				{ kind: "primary", columns: ["id"] },
				{ kind: "unique", columns: ["id", "spend"] },
			],
			indexes: [{ unique: false, method: "btree", keys: ["spend"], predicate: null }],
		},
	],
};

describe("PostgreSQL schema preflight", () => {
	it("兼容快照通过且允许接管后新增表、列和索引", () => {
		const actual: SchemaSnapshot = {
			...compatible,
			tables: [
				{
					...compatible.tables[0]!,
					columns: [...compatible.tables[0]!.columns, { name: "managed_extra", type: "text", nullable: true, default: null }],
					indexes: [
						...compatible.tables[0]!.indexes,
						{ unique: false, method: "btree", keys: ["managed_extra"], predicate: null },
					],
				},
				{ name: "LiteLLM_ManagedExtra", columns: [], constraints: [], indexes: [] },
			],
		};
		expect(compareSchemaSnapshots(compatible, actual)).toEqual([]);
	});

	it.each([
		["table", { ...compatible, tables: [] }],
		["column", { ...compatible, tables: [{ ...compatible.tables[0]!, columns: compatible.tables[0]!.columns.slice(0, 1) }] }],
		[
			"physical type",
			{
				...compatible,
				tables: [
					{
						...compatible.tables[0]!,
						columns: compatible.tables[0]!.columns.map((column) =>
							column.name === "id" ? { ...column, type: "uuid" } : column,
						),
					},
				],
			},
		],
		[
			"nullable",
			{
				...compatible,
				tables: [
					{
						...compatible.tables[0]!,
						columns: compatible.tables[0]!.columns.map((column) =>
							column.name === "id" ? { ...column, nullable: true } : column,
						),
					},
				],
			},
		],
		[
			"default",
			{
				...compatible,
				tables: [
					{
						...compatible.tables[0]!,
						columns: compatible.tables[0]!.columns.map((column) =>
							column.name === "spend" ? { ...column, default: null } : column,
						),
					},
				],
			},
		],
		["primary", { ...compatible, tables: [{ ...compatible.tables[0]!, constraints: compatible.tables[0]!.constraints.slice(1) }] }],
		["unique", { ...compatible, tables: [{ ...compatible.tables[0]!, constraints: compatible.tables[0]!.constraints.slice(0, 1) }] }],
		["index", { ...compatible, tables: [{ ...compatible.tables[0]!, indexes: [] }] }],
	])("%s 漂移被拒绝", (_name, actual) => {
		expect(compareSchemaSnapshots(compatible, actual as SchemaSnapshot)).not.toEqual([]);
	});

	it("Python 基线锁定 text ID、double precision、非空默认值和 BIGINT", () => {
		const snapshot = baseline as SchemaSnapshot;
		const budget = snapshot.tables.find((table) => table.name === "LiteLLM_BudgetTable");
		const daily = snapshot.tables.find((table) => table.name === "LiteLLM_DailyUserSpend");
		expect(budget?.columns.find((column) => column.name === "budget_id")).toMatchObject({ type: "text", nullable: false });
		expect(budget?.columns.find((column) => column.name === "max_budget")?.type).toBe("double precision");
		expect(daily?.columns.find((column) => column.name === "prompt_tokens")).toMatchObject({
			type: "bigint",
			nullable: false,
			default: "0",
		});
	});

	it("运行时 EndUser 映射与 Python 八列基线精确一致", () => {
		expect(() => validateRuntimeSchemaContract()).not.toThrow();
	});
});
