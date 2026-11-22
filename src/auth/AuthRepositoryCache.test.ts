import type { DrizzleDb } from "../core/db/Database";
import { AuthRepository } from "./AuthRepository";
import {
	AuthRepositoryCache,
	authCacheKey,
	authCacheTag,
	authRepositoryCache,
	invalidateAuthCacheForSpendSubjects,
	invalidateAuthCacheForSubject,
	invalidateAuthCacheForTokenHash,
	resolveAuthRepositoryCacheTtlMs,
	resolveAuthRepositoryRefreshAheadMs,
} from "./AuthRepositoryCache";

describe("AuthRepositoryCache", () => {
	it("命中缓存，TTL 到期后失效", () => {
		let now = 1000;
		const cache = new AuthRepositoryCache({ ttlMs: 100, now: () => now });

		cache.set("k", { id: 1 });
		expect(cache.get("k")).toEqual({ id: 1 });

		now += 99;
		expect(cache.get("k")).toEqual({ id: 1 });

		now += 2;
		expect(cache.get("k")).toBeUndefined();
	});

	it("不缓存空结果", () => {
		const cache = new AuthRepositoryCache({ ttlMs: 1000 });
		cache.set("k", null);
		expect(cache.get("k")).toBeUndefined();
		expect(cache.size).toBe(0);
	});

	it("ttl 为 0 时整体关闭", () => {
		const cache = new AuthRepositoryCache({ ttlMs: 0 });
		cache.set("k", { id: 1 });
		expect(cache.get("k")).toBeUndefined();
		expect(cache.enabled).toBe(false);
	});

	it("按 tag 批量失效", () => {
		const cache = new AuthRepositoryCache({ ttlMs: 60_000 });
		cache.set("a", { id: 1 }, [authCacheTag.user("u1")]);
		cache.set("b", { id: 2 }, [authCacheTag.team("t1")]);
		cache.set("c", { id: 3 }, [authCacheTag.user("u1"), authCacheTag.team("t1")]);

		cache.deleteByTag(authCacheTag.user("u1"));

		expect(cache.get("a")).toBeUndefined();
		expect(cache.get("b")).toEqual({ id: 2 });
		expect(cache.get("c")).toBeUndefined();
	});

	it("超过容量时淘汰最旧条目", () => {
		const cache = new AuthRepositoryCache({ ttlMs: 60_000, maxEntries: 2 });
		cache.set("a", 1);
		cache.set("b", 2);
		cache.set("c", 3);

		expect(cache.get("a")).toBeUndefined();
		expect(cache.get("b")).toBe(2);
		expect(cache.get("c")).toBe(3);
	});

	it("记账后按主体失效对应缓存", () => {
		authRepositoryCache.clear();
		authRepositoryCache.set(authCacheKey.verificationToken("hash-1"), { token: "hash-1" }, [authCacheTag.user("u1")]);
		authRepositoryCache.set(authCacheKey.user("u1"), { userId: "u1" }, [authCacheTag.user("u1")]);
		authRepositoryCache.set(authCacheKey.team("t1"), { teamId: "t1" }, [authCacheTag.team("t1")]);
		authRepositoryCache.set(authCacheKey.budget("b1"), { budget_id: "b1" });

		invalidateAuthCacheForSpendSubjects({ tokenHash: "hash-1", userId: "u1", teamId: "t1" });

		expect(authRepositoryCache.get(authCacheKey.verificationToken("hash-1"))).toBeUndefined();
		expect(authRepositoryCache.get(authCacheKey.user("u1"))).toBeUndefined();
		expect(authRepositoryCache.get(authCacheKey.team("t1"))).toBeUndefined();
		expect(authRepositoryCache.get(authCacheKey.budget("b1"))).toEqual({ budget_id: "b1" });
	});

	it("剩余 TTL 低于阈值时立刻返回旧值并在后台补读", async () => {
		let now = 0;
		const cache = new AuthRepositoryCache({ ttlMs: 1000, refreshAheadMs: 300, now: () => now });
		cache.set("k", { id: 1 });
		now = 800;

		const load = jest.fn(async () => ({ id: 2 }));
		expect(await cache.load("k", load)).toEqual({ id: 1 });
		await cache.settleRefreshes();

		expect(load).toHaveBeenCalledTimes(1);
		expect(cache.get("k")).toEqual({ id: 2 });
		expect(cache.refreshing).toBe(0);
	});

	it("剩余 TTL 充足时不补读", async () => {
		let now = 0;
		const cache = new AuthRepositoryCache({ ttlMs: 1000, refreshAheadMs: 300, now: () => now });
		cache.set("k", { id: 1 });
		now = 100;

		const load = jest.fn(async () => ({ id: 2 }));
		expect(await cache.load("k", load)).toEqual({ id: 1 });
		await cache.settleRefreshes();

		expect(load).not.toHaveBeenCalled();
	});

	it("同一键并发命中只补读一次", async () => {
		let now = 0;
		const cache = new AuthRepositoryCache({ ttlMs: 1000, refreshAheadMs: 300, now: () => now });
		cache.set("k", { id: 1 });
		now = 900;

		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const load = jest.fn(async () => {
			await gate;
			return { id: 2 };
		});

		expect(await cache.load("k", load)).toEqual({ id: 1 });
		expect(await cache.load("k", load)).toEqual({ id: 1 });
		expect(load).toHaveBeenCalledTimes(1);

		release?.();
		await cache.settleRefreshes();
		expect(cache.get("k")).toEqual({ id: 2 });
	});

	it("补读发现实体已删除时移除条目", async () => {
		let now = 0;
		const cache = new AuthRepositoryCache({ ttlMs: 1000, refreshAheadMs: 300, now: () => now });
		cache.set("k", { id: 1 });
		now = 900;

		expect(await cache.load("k", async () => null)).toEqual({ id: 1 });
		await cache.settleRefreshes();

		expect(cache.get("k")).toBeUndefined();
		expect(cache.size).toBe(0);
	});

	it("补读期间条目被失效则不写回旧快照", async () => {
		let now = 0;
		const cache = new AuthRepositoryCache({ ttlMs: 1000, refreshAheadMs: 300, now: () => now });
		cache.set("k", { id: 1 });
		now = 900;

		expect(
			await cache.load("k", async () => {
				cache.delete("k");
				return { id: 2 };
			}),
		).toEqual({ id: 1 });
		await cache.settleRefreshes();

		expect(cache.get("k")).toBeUndefined();
	});

	it("补读失败保留旧值且不抛出", async () => {
		let now = 0;
		const cache = new AuthRepositoryCache({ ttlMs: 1000, refreshAheadMs: 300, now: () => now });
		cache.set("k", { id: 1 });
		now = 900;

		expect(
			await cache.load("k", async () => {
				throw new Error("db down");
			}),
		).toEqual({ id: 1 });
		await cache.settleRefreshes();

		expect(cache.get("k")).toEqual({ id: 1 });
		expect(cache.refreshing).toBe(0);
	});

	it("阈值 0 时退化为纯 TTL 缓存", async () => {
		let now = 0;
		const cache = new AuthRepositoryCache({ ttlMs: 1000, refreshAheadMs: 0, now: () => now });
		cache.set("k", { id: 1 });
		now = 999;

		const load = jest.fn(async () => ({ id: 2 }));
		expect(await cache.load("k", load)).toEqual({ id: 1 });
		await cache.settleRefreshes();

		expect(load).not.toHaveBeenCalled();
	});

	it("解析提前刷新阈值：默认取 TTL 四分之一，显式值夹到 TTL 以内", () => {
		expect(resolveAuthRepositoryRefreshAheadMs(undefined, 3000)).toBe(750);
		expect(resolveAuthRepositoryRefreshAheadMs("", 1000)).toBe(250);
		expect(resolveAuthRepositoryRefreshAheadMs("0", 3000)).toBe(0);
		expect(resolveAuthRepositoryRefreshAheadMs("5000", 3000)).toBe(3000);
		expect(resolveAuthRepositoryRefreshAheadMs("600", 3000)).toBe(600);
		expect(resolveAuthRepositoryRefreshAheadMs("600", 0)).toBe(0);
	});

	it("默认窗口按分钟级设置：TTL 5 分钟，提前刷新最后 75 秒", () => {
		// 单实例部署下应用内写都会写穿，TTL 只兜底旁路改库；窗口取得太短会让鉴权链
		// 每个实体每几秒回一次库，取得太长会让运维直接改库的变更藏太久。
		expect(resolveAuthRepositoryCacheTtlMs(undefined)).toBe(300_000);
		expect(resolveAuthRepositoryCacheTtlMs("")).toBe(300_000);
		expect(resolveAuthRepositoryRefreshAheadMs(undefined, 300_000)).toBe(75_000);
		// 显式配置仍然生效，0 表示关闭。
		expect(resolveAuthRepositoryCacheTtlMs("0")).toBe(0);
		expect(resolveAuthRepositoryCacheTtlMs("9000")).toBe(9000);
	});

	it("封禁与批量删号都会立即失效", () => {
		authRepositoryCache.clear();
		authRepositoryCache.set(authCacheKey.verificationToken("hash-2"), { token: "hash-2" }, [authCacheTag.user("u2")]);
		invalidateAuthCacheForTokenHash("hash-2");
		expect(authRepositoryCache.get(authCacheKey.verificationToken("hash-2"))).toBeUndefined();

		authRepositoryCache.set(authCacheKey.verificationToken("hash-3"), { token: "hash-3" }, [authCacheTag.user("u3")]);
		authRepositoryCache.set(authCacheKey.user("u3"), { userId: "u3" }, [authCacheTag.user("u3")]);
		invalidateAuthCacheForSubject({ userId: "u3" });
		expect(authRepositoryCache.get(authCacheKey.verificationToken("hash-3"))).toBeUndefined();
		expect(authRepositoryCache.get(authCacheKey.user("u3"))).toBeUndefined();
	});
});

function createStubDb(rows: unknown[]): { db: DrizzleDb; select: jest.Mock; update: jest.Mock } {
	const limit = jest.fn(async () => rows);
	const where = jest.fn(() => ({ limit: limit }));
	const from = jest.fn(() => ({ where: where }));
	const select = jest.fn(() => ({ from: from }));
	const updateWhere = jest.fn(async () => undefined);
	const update = jest.fn(() => ({ set: () => ({ where: updateWhere }) }));
	return { db: { select: select, update: update } as unknown as DrizzleDb, select: select, update: update };
}

describe("AuthRepository 读缓存", () => {
	beforeEach(() => {
		authRepositoryCache.clear();
	});

	it("同一实体的重复读取只打一次库", async () => {
		const stub = createStubDb([{ userId: "u1", spend: 1 }]);
		const repository = new AuthRepository(stub.db);

		const first = await repository.findUserById("u1");
		const second = await repository.findUserById("u1");

		expect(first).toEqual({ userId: "u1", spend: 1 });
		expect(second).toEqual(first);
		expect(stub.select).toHaveBeenCalledTimes(1);
	});

	it("记账失效后重新读库", async () => {
		const stub = createStubDb([{ userId: "u1", spend: 1 }]);
		const repository = new AuthRepository(stub.db);

		await repository.findUserById("u1");
		invalidateAuthCacheForSpendSubjects({ userId: "u1" });
		await repository.findUserById("u1");

		expect(stub.select).toHaveBeenCalledTimes(2);
	});

	it("不存在的实体每次都会重新读库（负结果不缓存）", async () => {
		const stub = createStubDb([]);
		const repository = new AuthRepository(stub.db);

		expect(await repository.findUserById("missing")).toBeNull();
		expect(await repository.findUserById("missing")).toBeNull();

		expect(stub.select).toHaveBeenCalledTimes(2);
	});

	it("注销后不再返回缓存里的旧行", async () => {
		const stub = createStubDb([{ token: "hash-1", blocked: false }]);
		const repository = new AuthRepository(stub.db);

		await repository.findVerificationTokenByHash("hash-1");
		await repository.revokeVerificationTokenByHash("hash-1");
		await repository.findVerificationTokenByHash("hash-1");

		expect(stub.update).toHaveBeenCalledTimes(1);
		expect(stub.select).toHaveBeenCalledTimes(2);
	});
});
