import { ConfigRepository, configRepositoryFor } from "../ConfigRepository";
import { EntryCache } from "./EntryCache";
import { singletonFor, tableCacheFor } from "./registry";

interface Row {
	id: string;
	value?: string;
}

/** 模拟 Drizzle 连接：只需要身份与 `select().from()` 的形状。 */
function fakeDb(rows: Row[]): { db: { select: () => { from: () => Promise<Row[]> } }; loads: () => number; rows: Row[] } {
	let loads = 0;
	const db = {
		select: () => ({
			from: async () => {
				loads += 1;
				return rows.map((row) => ({ ...row }));
			},
		}),
	};
	return { db: db, loads: () => loads, rows: rows };
}

describe("registry", () => {
	it("同一连接复用同一个整表副本，不同连接互不影响", async () => {
		const left = fakeDb([{ id: "a" }]);
		const right = fakeDb([{ id: "b" }]);
		const loader = (source: ReturnType<typeof fakeDb>) => () => source.db.select().from();

		const first = tableCacheFor<Row>(left.db as never, "t", loader(left));
		const second = tableCacheFor<Row>(left.db as never, "t", loader(left));
		expect(second).toBe(first);

		const other = tableCacheFor<Row>(right.db as never, "t", loader(right));
		expect(other).not.toBe(first);
		expect(await first.rows()).toEqual([{ id: "a" }]);
		expect(await other.rows()).toEqual([{ id: "b" }]);
	});

	it("同一连接复用同一个仓储实例", () => {
		const created: unknown[] = [];
		const factory = singletonFor((db: object) => {
			const repository = { db: db };
			created.push(repository);
			return repository;
		});
		const db = {};

		expect(factory(db as never)).toBe(factory(db as never));
		expect(created).toHaveLength(1);
	});

	it("绕过工厂直接构造的仓储仍指向同一份副本，不会出现第二份缓存", async () => {
		const source = fakeDb([]);
		const shared = configRepositoryFor(source.db as never);
		const direct = new ConfigRepository(source.db as never);

		// snapshotRows 走的是按连接绑定的副本：两条路径只装载一次。
		await shared.snapshotRows();
		await direct.snapshotRows();
		expect(source.loads()).toBe(1);
		expect(direct.revision()).toBe(shared.revision());
	});
});

describe("EntryCache", () => {
	const now = { value: 1_000 };

	it("过期的条目不再命中，并按需重新读取", async () => {
		const cache = new EntryCache<Row>({ ttlMs: 100, now: () => now.value });
		cache.set("k", { id: "a" });

		now.value += 99;
		expect(cache.get<Row>("k")).toEqual({ id: "a" });

		now.value += 2;
		expect(cache.get<Row>("k")).toBeUndefined();
	});

	it("TTL 未到但剩余时间不足阈值时，先返回旧值再后台补读", async () => {
		const cache = new EntryCache<Row>({ ttlMs: 1000, refreshAheadMs: 300, now: () => now.value, label: "test" });
		const gate: { release?: () => void } = {};
		// 补读挂起，用来证明命中路径不等它：只有主动 release 后新值才进缓存。
		const load = (): Promise<Row> =>
			new Promise<Row>((resolve) => {
				gate.release = () => resolve({ id: "fresh" });
			});

		cache.set("k", { id: "old" });
		now.value += 800; // 剩余 200 < 300
		expect(await cache.load("k", load)).toEqual({ id: "old" });
		expect(cache.get<Row>("k")).toEqual({ id: "old" });

		gate.release?.();
		await cache.settleRefreshes();
		expect(cache.get<Row>("k")).toEqual({ id: "fresh" });
	});

	it("按标签失效会清掉同一实体的多条记录", () => {
		const cache = new EntryCache<Row>({ ttlMs: 1000, now: () => now.value });
		cache.set("user:u1", { id: "u1" }, ["user:u1"]);
		cache.set("token:t1", { id: "t1" }, ["user:u1"]);
		cache.set("team:x", { id: "x" }, ["team:x"]);

		cache.deleteByTag("user:u1");
		expect(cache.get<Row>("user:u1")).toBeUndefined();
		expect(cache.get<Row>("token:t1")).toBeUndefined();
		expect(cache.get<Row>("team:x")).toEqual({ id: "x" });
	});

	it("负结果不写入缓存", async () => {
		const cache = new EntryCache<Row>({ ttlMs: 1000, now: () => now.value });
		let reads = 0;
		const load = async (): Promise<Row | null> => {
			reads += 1;
			return null;
		};

		expect(await cache.load("missing", load)).toBeNull();
		expect(await cache.load("missing", load)).toBeNull();
		expect(reads).toBe(2);
	});
});
