import { modelRepositoryFor, type ModelRow } from "./ModelRepository";

function modelRow(overrides: Partial<ModelRow> = {}): ModelRow {
	return {
		model_id: "model-1",
		model_name: "gpt",
		litellm_params: { model: "openai/gpt-4", litellm_credential_name: "shared-credential" },
		model_info: { id: "model-1" },
		created_at: new Date("2026-01-01T00:00:00.000Z"),
		created_by: "user-a",
		updated_at: new Date("2026-01-01T00:00:00.000Z"),
		updated_by: "user-a",
		...overrides,
	};
}

function createDb(state: { rows: ModelRow[] }): { db: never; selects: () => number } {
	let selects = 0;
	const db = {
		select: () => ({
			from: () => {
				selects += 1;
				return Promise.resolve(state.rows.map((row) => ({ ...row })));
			},
		}),
		insert: () => ({
			values: (values: Record<string, unknown>) => ({
				returning: async () => [{ ...modelRow(), ...values }],
			}),
		}),
		update: () => ({
			set: (values: Record<string, unknown>) => ({
				where: () => ({ returning: async () => [{ ...state.rows[0], ...values }] }),
			}),
		}),
		delete: () => ({ where: () => Promise.resolve({ rowCount: 1 }) }),
	};
	return { db: db as never, selects: () => selects };
}

describe("ModelRepository", () => {
	it("同一数据库连接的多次读取只装载一次，并共享同一份副本", async () => {
		const state = { rows: [modelRow()] };
		const { db, selects } = createDb(state);

		const rows = await modelRepositoryFor(db).snapshotRows();
		const again = await modelRepositoryFor(db).snapshotRows();

		expect(selects()).toBe(1);
		expect(rows.map((row) => row.model_id)).toEqual(["model-1"]);
		expect(await modelRepositoryFor(db).findById("model-1")).toMatchObject({ model_name: "gpt" });
		expect(selects()).toBe(1);
		expect(again).toEqual(rows);
	});

	it("写入后副本失效，下一次读取装载数据库中的新行", async () => {
		const state = { rows: [modelRow()] };
		const { db, selects } = createDb(state);
		const repository = modelRepositoryFor(db);

		await repository.snapshotRows();
		state.rows = [modelRow({ model_name: "renamed" })];
		await repository.update("model-1", { model_name: "renamed", updated_by: "user-b" });

		expect((await repository.snapshotRows())[0]?.model_name).toBe("renamed");
		expect(selects()).toBe(2);
	});

	it("凭据引用检查基于副本完成，引用存在时阻止删除", async () => {
		const state = { rows: [modelRow(), modelRow({ model_id: "model-2", litellm_params: { model: "openai/gpt-4o" } })] };
		const { db, selects } = createDb(state);
		const repository = modelRepositoryFor(db);

		await expect(repository.isCredentialReferenced("shared-credential")).resolves.toBe(true);
		await expect(repository.isCredentialReferenced("unused-credential")).resolves.toBe(false);
		expect(selects()).toBe(1);
	});
});
