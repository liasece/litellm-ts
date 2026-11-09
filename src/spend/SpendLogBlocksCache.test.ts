import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import {
	SpendLogBlockCache,
	clearSpendLogBlockCacheForTests,
	collectSpendLogBlocks,
	hydrateSpendLogRows,
	rememberSpendLogBlocks,
	selectMissingSpendLogBlocks,
} from "./SpendLogBlocks";

/** 块表的一行（测试用的假数据）。 */
interface FakeBlockRow {
	readonly blockId: string;
	readonly payload: unknown;
	readonly byteSize: number;
}

/**
 * 构造只回答块查询的假数据库，并统计 `select` 调用次数。
 * @param rows - 查询应返回的行
 */
function makeFakeDb(rows: readonly FakeBlockRow[]): { db: NodePgDatabase<typeof schema>; queries: () => number } {
	let queries = 0;
	const db = {
		select: () => {
			queries += 1;
			return {
				from: () => ({
					where: async () => rows,
				}),
			};
		},
	} as unknown as NodePgDatabase<typeof schema>;
	return { db: db, queries: () => queries };
}

/**
 * 造一段会被编码成引用的对话。
 * @param count - 消息条数
 */
function makeMessages(count: number): Record<string, unknown>[] {
	return Array.from({ length: count }, (_unused, index) => ({
		role: index % 2 === 0 ? "user" : "assistant",
		content: `message-${index}`,
	}));
}

describe("SpendLogBlockCache", () => {
	it("按字节上限淘汰最久未使用的载荷，但保留已知 id", () => {
		const cache = new SpendLogBlockCache(100);
		cache.remember("a", { value: 1 }, 60);
		cache.remember("b", { value: 2 }, 60);

		expect(cache.read("a")).toBeUndefined();
		expect(cache.read("b")).toEqual({ payload: { value: 2 }, byteSize: 60 });
		expect(cache.isKnown("a")).toBe(true);
		expect(cache.stats()).toEqual({ bytes: 60, entries: 1, known: 2 });
	});

	it("命中时刷新 LRU 位置", () => {
		const cache = new SpendLogBlockCache(120);
		cache.remember("a", { value: 1 }, 60);
		cache.remember("b", { value: 2 }, 60);
		// 读 a 把它移到队尾，再插入 c 时淘汰的是 b
		expect(cache.read("a")).toBeDefined();
		cache.remember("c", { value: 3 }, 60);

		expect(cache.read("b")).toBeUndefined();
		expect(cache.read("a")).toBeDefined();
		expect(cache.read("c")).toBeDefined();
	});
});

describe("hydrateSpendLogRows：进程内块缓存", () => {
	it("同一批引用第二次组装不再访问数据库", async () => {
		const messages = makeMessages(5);
		const encoded = collectSpendLogBlocks({ messages: messages, proxyServerRequest: {} });
		const rows = encoded.blocks.map((block) => ({
			blockId: block.blockId,
			payload: block.payload,
			byteSize: block.byteSize,
		}));
		const fake = makeFakeDb(rows);
		clearSpendLogBlockCacheForTests();

		const [first] = await hydrateSpendLogRows(fake.db, [
			{ messages: encoded.messages, proxy_server_request: encoded.proxyServerRequest },
		]);
		expect(fake.queries()).toBe(1);

		const [second] = await hydrateSpendLogRows(fake.db, [
			{ messages: encoded.messages, proxy_server_request: encoded.proxyServerRequest },
		]);
		expect(fake.queries()).toBe(1);
		expect(second?.messages).toEqual(first?.messages);
		expect((second?.messages as Record<string, unknown>[] | undefined)?.[0]).toEqual(messages[0]);
	});

	it("缺块时用占位对象补齐，并且不把占位写进缓存", async () => {
		const messages = makeMessages(5);
		const encoded = collectSpendLogBlocks({ messages: messages, proxyServerRequest: {} });
		const fake = makeFakeDb([]);
		clearSpendLogBlockCacheForTests();

		const [row] = await hydrateSpendLogRows(fake.db, [
			{ messages: encoded.messages, proxy_server_request: encoded.proxyServerRequest },
		]);
		expect(fake.queries()).toBe(1);
		expect(row?.messages).toBeDefined();

		// 缓存里没有载荷，下一次组装仍要回源（而不是把占位当成内容）
		await hydrateSpendLogRows(fake.db, [{ messages: encoded.messages, proxy_server_request: encoded.proxyServerRequest }]);
		expect(fake.queries()).toBe(2);
	});
});

describe("selectMissingSpendLogBlocks：写前判存", () => {
	it("只返回数据库中不存在的块", async () => {
		const encoded = collectSpendLogBlocks({ messages: makeMessages(5), proxyServerRequest: {} });
		const existing = encoded.blocks.slice(0, 3).map((block) => ({
			blockId: block.blockId,
			payload: block.payload,
			byteSize: block.byteSize,
		}));
		const fake = makeFakeDb(existing);
		clearSpendLogBlockCacheForTests();

		const missing = await selectMissingSpendLogBlocks(fake.db, encoded.blocks);
		expect(missing.map((block) => block.blockId)).toEqual(encoded.blocks.slice(3).map((block) => block.blockId));
	});

	it("核对通过并写入后，再次判存不再查询数据库", async () => {
		const encoded = collectSpendLogBlocks({ messages: makeMessages(5), proxyServerRequest: {} });
		const fake = makeFakeDb([]);
		clearSpendLogBlockCacheForTests();

		const missing = await selectMissingSpendLogBlocks(fake.db, encoded.blocks);
		expect(missing).toHaveLength(encoded.blocks.length);
		rememberSpendLogBlocks(missing);
		const queriesAfterFirst = fake.queries();

		await expect(selectMissingSpendLogBlocks(fake.db, encoded.blocks)).resolves.toHaveLength(0);
		expect(fake.queries()).toBe(queriesAfterFirst);
	});

	it("判存查询失败时回退为盲插，不阻断记账", async () => {
		const encoded = collectSpendLogBlocks({ messages: makeMessages(5), proxyServerRequest: {} });
		const brokenDb = {
			select: () => {
				throw new Error("database unavailable");
			},
		} as unknown as NodePgDatabase<typeof schema>;
		clearSpendLogBlockCacheForTests();

		const missing = await selectMissingSpendLogBlocks(brokenDb, encoded.blocks);
		expect(missing).toHaveLength(encoded.blocks.length);
	});
});
