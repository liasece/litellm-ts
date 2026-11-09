import { revisionCounterFor, TableCache } from "./internal/TableCache";

interface Row {
	id: number;
	value?: string;
}

function createLoader(initial: Row[]): { load: () => Promise<Row[]>; calls: () => number; rows: Row[] } {
	let calls = 0;
	const rows = initial;
	return {
		load: async () => {
			calls += 1;
			return rows.map((row) => ({ ...row }));
		},
		calls: () => calls,
		rows: rows,
	};
}

describe("TableCache", () => {
	it("并发读取合并为一次装载，后续读取直接命中副本，版本号只增一次", async () => {
		const loader = createLoader([{ id: 1 }]);
		const cache = new TableCache<Row>(loader.load, revisionCounterFor({}));

		const [first, second] = await Promise.all([cache.rows(), cache.rows()]);
		expect(loader.calls()).toBe(1);
		expect(first).toEqual([{ id: 1 }]);
		expect(second).toEqual([{ id: 1 }]);

		await cache.rows();
		expect(loader.calls()).toBe(1);
		expect(cache.revision()).toBe(1);
	});

	it("写入同步副本不重新查询，失效后下一次读取重新装载", async () => {
		const loader = createLoader([{ id: 1 }]);
		const cache = new TableCache<Row>(loader.load, revisionCounterFor({}));

		await cache.rows();
		cache.mutate((rows) => [...rows, { id: 2 }]);
		expect(await cache.rows()).toEqual([{ id: 1 }, { id: 2 }]);
		expect(loader.calls()).toBe(1);
		expect(cache.revision()).toBe(2);

		cache.invalidate();
		expect(await cache.rows()).toEqual([{ id: 1 }]);
		expect(loader.calls()).toBe(2);
	});

	it("副本未装载时写入或失效都不触发查询", async () => {
		const loader = createLoader([{ id: 1 }]);
		const cache = new TableCache<Row>(loader.load, revisionCounterFor({}));

		cache.mutate((rows) => rows);
		cache.invalidate();
		expect(loader.calls()).toBe(0);
		expect(cache.revision()).toBe(0);
	});

	it("冷启动装载失败时抛错（fail closed），失败不会被当成有效副本缓存", async () => {
		let shouldFail = true;
		let calls = 0;
		const cache = new TableCache<Row>(async () => {
			calls += 1;
			if (shouldFail) {
				throw new Error("db unavailable");
			}
			return [{ id: 7 }];
		}, revisionCounterFor({}));

		await expect(cache.rows()).rejects.toThrow("db unavailable");
		shouldFail = false;
		expect(await cache.rows()).toEqual([{ id: 7 }]);
		expect(calls).toBe(2);
	});

	it("同一数据库连接的缓存共享版本号", async () => {
		const db = {};
		const left = new TableCache<Row>(async () => [], revisionCounterFor(db));
		const right = new TableCache<Row>(async () => [], revisionCounterFor(db));

		await left.rows();
		expect(right.revision()).toBe(1);
		await right.rows();
		expect(left.revision()).toBe(2);
	});
});
