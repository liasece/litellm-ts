/**
 * 上游元信息服务的行为测试。
 *
 * 覆盖的是这份缓存真正承诺的四件事：不等待上游、过期先给旧值、失败/不支持只记一条
 * 负缓存、同一来源并发刷新只打一次上游。数据库与账号仓库都用内存假实现，测试不依赖
 * 网络或真实 auth 目录。
 */

import type { SubscriptionAccountStore } from "../accountStore";
import type { SubscriptionAccount, SubscriptionSource } from "../types";
import type { UpstreamModelMetaRepository, UpstreamModelMetaWrite } from "../../../repositories/UpstreamModelMetaRepository";
import { UpstreamModelInfoService } from "./service";
import type { UpstreamModelMetaRecord, UpstreamModelMetadataMap, UpstreamSourceAdapter } from "./types";

/** 造一个账号对象。 */
function account(source: SubscriptionSource, raw: Record<string, unknown> = { api_key: "k" }): SubscriptionAccount {
	return { id: "a1", source, key: "a.json", disabled: false, weight: 1, raw };
}

/** 内存仓库。 */
class FakeRepository {
	rows: UpstreamModelMetaRecord[] = [];
	readonly replaces: UpstreamModelMetaWrite[][] = [];
	readonly upserts: UpstreamModelMetaWrite[] = [];

	async listAll(): Promise<UpstreamModelMetaRecord[]> {
		return this.rows;
	}

	async replaceSource(_source: SubscriptionSource, records: readonly UpstreamModelMetaWrite[]): Promise<void> {
		this.replaces.push([...records]);
	}

	async upsert(record: UpstreamModelMetaWrite): Promise<void> {
		this.upserts.push(record);
	}
}

/** 可编程适配器。 */
function makeAdapter(options: {
	source?: SubscriptionSource;
	supported?: boolean;
	entries?: readonly unknown[];
	fail?: Error;
	parse?: (entries: readonly unknown[]) => UpstreamModelMetadataMap;
}): UpstreamSourceAdapter & { calls: number } {
	const adapter = {
		source: options.source ?? "opencode-go",
		supported: options.supported ?? true,
		calls: 0,
		hasCredential: (candidate: SubscriptionAccount) => candidate.raw["api_key"] === "k",
		async list(): Promise<readonly unknown[] | null> {
			adapter.calls += 1;
			if (options.fail !== undefined) {
				throw options.fail;
			}
			return options.entries ?? [];
		},
		parse(entries: readonly unknown[]): UpstreamModelMetadataMap {
			if (options.parse !== undefined) {
				return options.parse(entries);
			}
			return new Map(entries.map((entry) => [(entry as { id: string }).id, { contextWindow: 1_000_000, maxOutputTokens: 131_072 }]));
		},
	};
	return adapter;
}

/** 构造服务。 */
function makeService(options: {
	repository?: FakeRepository;
	adapter?: UpstreamSourceAdapter;
	accounts?: SubscriptionAccount[];
	now?: () => number;
	ttlMs?: number;
	errorTtlMs?: number;
}): { service: UpstreamModelInfoService; repository: FakeRepository; adapter: UpstreamSourceAdapter & { calls: number } } {
	const repository = options.repository ?? new FakeRepository();
	const adapter = (options.adapter ?? makeAdapter({})) as UpstreamSourceAdapter & { calls: number };
	const accounts = options.accounts ?? [account("opencode-go")];
	const service = new UpstreamModelInfoService({
		repository: repository as unknown as UpstreamModelMetaRepository,
		accounts: { list: async () => accounts } as unknown as SubscriptionAccountStore,
		adapters: [adapter],
		sources: [adapter.source],
		now: options.now,
		ttlMs: options.ttlMs ?? 4 * 60 * 60_000,
		errorTtlMs: options.errorTtlMs ?? 10 * 60_000,
		sweepIntervalMs: 60 * 60_000,
	});
	return { service, repository, adapter };
}

describe("UpstreamModelInfoService", () => {
	it("刷新成功后写入模型行与来源状态行，并让 metadata() 命中", async () => {
		const { service, repository, adapter } = makeService({ adapter: makeAdapter({ entries: [{ id: "glm-5.3" }] }) });
		await service.refresh("opencode-go");
		expect(adapter.calls).toBe(1);
		const [writes] = repository.replaces;
		expect(writes?.map((row) => row.modelId)).toEqual(["glm-5.3"]);
		// 来源级状态行单独落库，重启后才不会立刻再回源。
		expect(repository.upserts.map((row) => row.modelId)).toEqual(["*"]);
		const record = service.get("opencode-go", "glm-5.3");
		expect(record?.status).toBe("ok");
		expect(service.metadata("opencode-go", "glm-5.3")).toMatchObject({ contextWindow: 1_000_000, maxOutputTokens: 131_072 });
		expect(service.snapshot("opencode-go").status).toBe("ok");
	});

	it("上游不提供元信息接口时只记 unsupported 负缓存，不发请求", async () => {
		const adapter = makeAdapter({ supported: false });
		const { service, repository } = makeService({ adapter });
		await service.refresh("opencode-go");
		expect(adapter.calls).toBe(0);
		expect(repository.upserts).toHaveLength(1);
		expect(repository.upserts[0]).toMatchObject({ modelId: "*", status: "unsupported" });
		expect(service.snapshot("opencode-go").status).toBe("unsupported");
	});

	it("没有可用账号时记 error，而不是清空已有模型行", async () => {
		const { service, repository } = makeService({ accounts: [] });
		await service.refresh("opencode-go");
		expect(repository.replaces).toHaveLength(0);
		expect(repository.upserts[0]).toMatchObject({ modelId: "*", status: "error" });
		expect(service.snapshot("opencode-go").error).toContain("没有可用");
	});

	it("拉取失败按更短的 error TTL 重试", async () => {
		let now = 1_000_000;
		const { service, repository, adapter } = makeService({
			adapter: makeAdapter({ fail: new Error("HTTP 500"), entries: [{ id: "glm-5.3" }] }),
			now: () => now,
			errorTtlMs: 60_000,
		});
		await service.refresh("opencode-go");
		expect(repository.upserts[0]).toMatchObject({ status: "error" });
		const firstExpiry = repository.upserts[0]?.expiresAt.getTime();
		expect(firstExpiry).toBe(now + 60_000);
		// 未到期：巡检不再打上游
		now += 30_000;
		await service.refreshExpired();
		expect(adapter.calls).toBe(1);
		// 到期后重试
		now += 40_000;
		await service.refreshExpired();
		expect(adapter.calls).toBe(2);
	});

	it("同一来源并发刷新共享一次上游请求", async () => {
		const { service, adapter } = makeService({ adapter: makeAdapter({ entries: [{ id: "glm-5.3" }] }) });
		await Promise.all([service.refresh("opencode-go"), service.refresh("opencode-go"), service.refreshExpired()]);
		expect(adapter.calls).toBe(1);
	});

	it("过期读取立即返回旧值，并在后台触发刷新", async () => {
		let now = 10_000_000;
		const expired: UpstreamModelMetaRecord = {
			source: "opencode-go",
			modelId: "*",
			status: "ok",
			fetchedAt: new Date(now - 5 * 60 * 60_000),
			expiresAt: new Date(now - 60_000),
		};
		const modelRow: UpstreamModelMetaRecord = {
			source: "opencode-go",
			modelId: "glm-5.3",
			status: "ok",
			metadata: { contextWindow: 1_000_000 },
			fetchedAt: expired.fetchedAt,
			expiresAt: expired.expiresAt,
		};
		const repository = new FakeRepository();
		repository.rows = [expired, modelRow];
		const adapter = makeAdapter({ entries: [{ id: "glm-5.3" }] });
		const { service } = makeService({ repository, adapter, now: () => now });
		await service.initialize();
		const record = service.get("opencode-go", "glm-5.3");
		// 关键契约：读取立刻拿到旧值，刷新在后台继续。
		expect(record?.metadata).toMatchObject({ contextWindow: 1_000_000 });
		await Promise.resolve();
		await Promise.resolve();
		expect(adapter.calls).toBe(1);
		service.stop();
	});

	it("启动时装载持久行，不为未过期的来源发起请求", async () => {
		const record: UpstreamModelMetaRecord = {
			source: "opencode-go",
			modelId: "*",
			status: "ok",
			fetchedAt: new Date(),
			expiresAt: new Date(Date.now() + 60 * 60_000),
		};
		const repository = new FakeRepository();
		repository.rows = [record];
		const adapter = makeAdapter({});
		const { service } = makeService({ repository, adapter });
		await service.initialize();
		await Promise.resolve();
		expect(adapter.calls).toBe(0);
		expect(service.snapshot("opencode-go").status).toBe("ok");
		service.stop();
	});
});

describe("回源放大防护", () => {
	it("目录新鲜时，查不到的模型不会触发回源", async () => {
		const { service, adapter } = makeService({ adapter: makeAdapter({ entries: [{ id: "glm-5.3" }] }) });
		await service.refresh("opencode-go");
		service.stop();
		expect(adapter.calls).toBe(1);
		for (let i = 0; i < 20; i += 1) {
			expect(service.get("opencode-go", `missing-${i}`)).toBeUndefined();
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(adapter.calls).toBe(1);
	});

	it("来源状态过期时，并发读取只回源一次", async () => {
		const { service, adapter } = makeService({ adapter: makeAdapter({ entries: [{ id: "glm-5.3" }] }), ttlMs: 0 });
		await service.refresh("opencode-go");
		service.stop();
		expect(adapter.calls).toBe(1);
		service.get("opencode-go", "glm-5.3");
		service.get("opencode-go", "glm-5.3");
		await new Promise((resolve) => setTimeout(resolve, 5));
		// 手动刷新 1 次 + 两次读取合并出的后台刷新 1 次；30 秒内的后续读取不会再回源。
		expect(adapter.calls).toBe(2);
		service.get("opencode-go", "glm-5.3");
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(adapter.calls).toBe(2);
	});
});
