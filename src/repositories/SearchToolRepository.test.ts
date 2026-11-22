import type { DrizzleDb } from "../core/db/Database";
import { SearchToolRepository, type SearchToolRow } from "./SearchToolRepository";

/** 假库统计：用来区分「写穿副本」与「重新回表」。 */
interface FakeState {
	rows: SearchToolRow[];
	selects: number;
	inserts: number;
	updates: number;
	deletes: number;
}

/**
 * 构造一行搜索工具。
 * @param id - 主键
 * @param name - 运行时名称
 */
function makeRow(id: string, name: string): SearchToolRow {
	const at = new Date("2026-01-01T00:00:00.000Z");
	return {
		search_tool_id: id,
		search_tool_name: name,
		litellm_params: { search_provider: "google_pse" },
		search_tool_info: null,
		created_at: at,
		updated_at: at,
	};
}

/**
 * 假库：select 只服务整表装载，写操作直接改内存行并返回写后的行。
 * @param state - 行与调用计数
 */
function createFakeDb(state: FakeState): DrizzleDb {
	const db = {
		select: () => ({
			from: async () => {
				state.selects += 1;
				return state.rows.map((row) => ({ ...row }));
			},
		}),
		insert: () => ({
			values: (values: Partial<SearchToolRow>) => ({
				returning: async () => {
					state.inserts += 1;
					const row: SearchToolRow = {
						...makeRow(String(values.search_tool_id), String(values.search_tool_name)),
						...values,
					};
					state.rows = [...state.rows, row];
					return [row];
				},
			}),
		}),
		update: () => ({
			set: (values: Partial<SearchToolRow>) => ({
				where: () => ({
					returning: async () => {
						state.updates += 1;
						const updated = state.rows.map((row) => ({
							...row,
							...values,
							updated_at: new Date("2026-01-02T00:00:00.000Z"),
						}));
						state.rows = updated;
						return updated;
					},
				}),
			}),
		}),
		delete: () => ({
			where: () => ({
				returning: async () => {
					state.deletes += 1;
					const removed = state.rows;
					state.rows = [];
					return removed;
				},
			}),
		}),
	};
	return db as unknown as DrizzleDb;
}

function emptyState(rows: SearchToolRow[] = []): FakeState {
	return { rows: rows, selects: 0, inserts: 0, updates: 0, deletes: 0 };
}

describe("搜索工具整表副本写穿", () => {
	it("新建后副本立即包含新行，不再回表", async () => {
		const state = emptyState();
		const repository = new SearchToolRepository(createFakeDb(state));

		await expect(repository.snapshotRows()).resolves.toEqual([]);
		expect(state.selects).toBe(1);

		const created = await repository.create({
			search_tool_name: "pse-prod",
			litellm_params: { search_provider: "google_pse" },
		});

		expect(created).toBeDefined();
		await expect(repository.findByName("pse-prod")).resolves.toMatchObject({
			search_tool_id: created!.search_tool_id,
		});
		expect(state.inserts).toBe(1);
		// 副本已装载，写后用副本回答，不该再有一次整表查询。
		expect(state.selects).toBe(1);
	});

	it("更新后副本里同一主键读到新名称", async () => {
		const state = emptyState([makeRow("tool-1", "old-name")]);
		const repository = new SearchToolRepository(createFakeDb(state));
		await repository.snapshotRows();

		const updated = await repository.update("tool-1", {
			search_tool_name: "new-name",
			litellm_params: { search_provider: "google_pse", search_engine_id: "engine" },
		});

		expect(updated).toMatchObject({ search_tool_id: "tool-1", search_tool_name: "new-name" });
		await expect(repository.findById("tool-1")).resolves.toMatchObject({ search_tool_name: "new-name" });
		await expect(repository.findByName("old-name")).resolves.toBeUndefined();
		await expect(repository.snapshotRows()).resolves.toHaveLength(1);
		expect(state.updates).toBe(1);
		expect(state.selects).toBe(1);
	});

	it("删除后副本立即移除该行", async () => {
		const state = emptyState([makeRow("tool-1", "pse-prod")]);
		const repository = new SearchToolRepository(createFakeDb(state));
		await repository.snapshotRows();

		const removed = await repository.remove("tool-1");

		expect(removed).toMatchObject({ search_tool_id: "tool-1" });
		await expect(repository.findById("tool-1")).resolves.toBeUndefined();
		await expect(repository.findByName("pse-prod")).resolves.toBeUndefined();
		await expect(repository.snapshotRows()).resolves.toEqual([]);
		expect(state.deletes).toBe(1);
		expect(state.selects).toBe(1);
	});
});
