/**
 * 上游模型元信息服务：持久弱缓存 + 后台刷新。
 *
 * 三条规则决定了这里的结构：
 * 1. **不阻断请求**：查询只读内存；过期就返回旧值并在后台刷新，调用方从不等待上游。
 * 2. **负缓存**：拉取失败、上游不提供接口、没有账号，都会写一条带过期时间的状态行，
 *    避免每次读取都重打上游。
 * 3. **并发去重**：同一来源同一时间只有一个在途刷新；不同来源互不影响。
 *
 * 过期时间：正常与 unsupported 走 `ttlMs`（默认 4 小时），失败走更短的 `errorTtlMs`
 * （默认 10 分钟），让上游恢复后能尽快自愈，同时不至于连续失败时反复重试。
 */

import type { Logger } from "../../../core/utils/logger";
import type { SubscriptionAccountStore } from "../accountStore";
import type { SubscriptionSource } from "../types";
import { createModuleLogger } from "../../../core/utils/logger";
import { slimRawEntry } from "./normalize";
import type { UpstreamModelMetaRepository, UpstreamModelMetaWrite } from "./repository";
import { UPSTREAM_SOURCE_STATUS_ID, type UpstreamModelMetaRecord, type UpstreamModelMetadata, type UpstreamSourceAdapter } from "./types";

/** 默认过期时间：4 小时。 */
export const UPSTREAM_META_TTL_MS = 4 * 60 * 60_000;
/** 失败/缺凭据时的重试间隔。 */
export const UPSTREAM_META_ERROR_TTL_MS = 10 * 60_000;
/** 过期巡检间隔。 */
export const UPSTREAM_META_MIN_REFRESH_INTERVAL_MS = 30_000;

export const UPSTREAM_META_SWEEP_INTERVAL_MS = 10 * 60_000;

/** 服务构造参数。 */
export interface UpstreamModelInfoServiceOptions {
	/** 持久化仓库。 */
	readonly repository: UpstreamModelMetaRepository;
	/** 账号仓库；用于取凭据。 */
	readonly accounts: SubscriptionAccountStore;
	/** 各来源适配器。 */
	readonly adapters: readonly UpstreamSourceAdapter[];
	/** 需要维护的来源集合；缺省取适配器覆盖的来源。 */
	readonly sources?: readonly SubscriptionSource[];
	/** fetch 实现；测试注入。 */
	readonly fetchImpl?: typeof fetch;
	/** 当前时间；测试注入。 */
	readonly now?: () => number;
	/** 正常过期时间（毫秒）。 */
	readonly ttlMs?: number;
	/** 失败过期时间（毫秒）。 */
	readonly errorTtlMs?: number;
	/** 巡检间隔（毫秒）。 */
	readonly sweepIntervalMs?: number;
	/** 定时器实现；测试注入。 */
	readonly setIntervalImpl?: typeof setInterval;
	/** 日志器。 */
	readonly logger?: Logger;
	/** 单次上游超时（毫秒）。 */
	readonly fetchTimeoutMs?: number;
}

/** 单个来源的内存状态。 */
interface SourceState {
	/** 模型行与来源级状态行（`*`）。 */
	readonly records: Map<string, UpstreamModelMetaRecord>;
	/** 是否有在途刷新。 */
	refreshing: boolean;
	/** 最近一次失败原因。 */
	lastError?: string;
}

/** 对外快照：某个来源的状态。 */
export interface UpstreamSourceSnapshot {
	/**
	 *
	 */
	readonly source: SubscriptionSource;
	/**
	 *
	 */
	readonly status: UpstreamModelMetaRecord["status"] | "missing";
	/**
	 *
	 */
	readonly models: number;
	/**
	 *
	 */
	readonly fetchedAt?: string;
	/**
	 *
	 */
	readonly expiresAt?: string;
	/**
	 *
	 */
	readonly error?: string;
	/**
	 *
	 */
	readonly refreshing: boolean;
}

/**
 * 判断记录是否已过期。
 * @param record - 缓存行
 * @param now - 当前毫秒
 */
export function isExpired(record: UpstreamModelMetaRecord | undefined, now: number): boolean {
	return record === undefined || record.expiresAt.getTime() <= now;
}

/** 上游模型元信息服务。 */
export class UpstreamModelInfoService {
	private readonly _repository: UpstreamModelMetaRepository;
	private readonly _accounts: SubscriptionAccountStore;
	private readonly _adapters: ReadonlyMap<SubscriptionSource, UpstreamSourceAdapter>;
	private readonly _sources: readonly SubscriptionSource[];
	private readonly _fetchImpl: typeof fetch;
	private readonly _now: () => number;
	private readonly _ttlMs: number;
	private readonly _errorTtlMs: number;
	private readonly _sweepIntervalMs: number;
	private readonly _setIntervalImpl: typeof setInterval;
	private readonly _logger: Logger;
	private readonly _fetchTimeoutMs: number;
	private readonly _state = new Map<SubscriptionSource, SourceState>();
	private readonly _inflight = new Map<SubscriptionSource, Promise<void>>();
	private readonly _lastAttemptAt = new Map<SubscriptionSource, number>();
	private _timer: ReturnType<typeof setInterval> | undefined;
	private _initialized = false;

	constructor(options: UpstreamModelInfoServiceOptions) {
		this._repository = options.repository;
		this._accounts = options.accounts;
		this._adapters = new Map(options.adapters.map((adapter) => [adapter.source, adapter]));
		this._sources = options.sources ?? [...this._adapters.keys()];
		this._fetchImpl = options.fetchImpl ?? fetch;
		this._now = options.now ?? (() => Date.now());
		this._ttlMs = options.ttlMs ?? UPSTREAM_META_TTL_MS;
		this._errorTtlMs = options.errorTtlMs ?? UPSTREAM_META_ERROR_TTL_MS;
		this._sweepIntervalMs = options.sweepIntervalMs ?? UPSTREAM_META_SWEEP_INTERVAL_MS;
		this._setIntervalImpl = options.setIntervalImpl ?? setInterval;
		this._logger = options.logger ?? createModuleLogger("upstream-model-info");
		this._fetchTimeoutMs = options.fetchTimeoutMs ?? 10_000;
	}

	/**
	 * 装载持久缓存并启动后台刷新。**不等待上游**：过期来源的刷新以 fire-and-forget 发起。
	 */
	async initialize(): Promise<void> {
		if (this._initialized) {
			return;
		}
		this._initialized = true;
		const rows = await this._repository.listAll();
		for (const row of rows) {
			// 防御损坏行：没有来源或模型 ID 的记录无法参与合并，直接跳过。
			if (!row.source || !row.modelId) {
				continue;
			}
			this._stateFor(row.source).records.set(row.modelId, row);
		}
		this._startTimer();
		// 启动时就把过期/缺失的来源刷一遍；失败只记日志，不影响开始服务。
		void this.refreshExpired().catch((error: unknown) => {
			this._logger.warn("启动时刷新上游模型元信息失败", { error: error instanceof Error ? error.message : String(error) });
		});
	}

	/** 停止定时器。 */
	stop(): void {
		if (this._timer !== undefined) {
			clearInterval(this._timer);
			this._timer = undefined;
		}
	}

	/**
	 * 读取某个上游模型的元信息；不会等待上游。
	 *
	 * 记录过期或缺失时触发一次后台刷新，本次仍返回已有的（stale）值。
	 * @param source - 来源
	 * @param modelId - 上游模型 ID
	 */
	get(source: SubscriptionSource, modelId: string): UpstreamModelMetaRecord | undefined {
		const state = this._stateFor(source);
		const record = state.records.get(modelId);
		const now = this._now();
		// 只有来源级状态过期、或该模型自己的记录过期才刷新。查不到的模型只要目录还新鲜就
		// 不再回源，否则每一次代理请求都会因为「本地没有这个模型」放大成一次上游调用。
		if (isExpired(state.records.get(UPSTREAM_SOURCE_STATUS_ID), now) || (record !== undefined && isExpired(record, now))) {
			this._scheduleRefresh(source);
		}
		return record;
	}

	/**
	 * 读取归一化元信息；只有 `ok` 且带 metadata 的记录才算命中。
	 * @param source - 来源
	 * @param modelId - 上游模型 ID
	 */
	metadata(source: SubscriptionSource, modelId: string): UpstreamModelMetadata | undefined {
		const record = this.get(source, modelId);
		return record?.status === "ok" ? record.metadata : undefined;
	}

	/**
	 * 读取命中的缓存行（含抓取时间）。写入 spend 日志时用它把「当时的上游价」与抓取时间一起冻结。
	 * @param source - 来源
	 * @param modelId - 上游模型 ID
	 */
	record(source: SubscriptionSource, modelId: string): UpstreamModelMetaRecord | undefined {
		const record = this.get(source, modelId);
		return record?.status === "ok" ? record : undefined;
	}

	/**
	 * 来源级快照；用于诊断接口。
	 * @param source - 来源
	 */
	snapshot(source: SubscriptionSource): UpstreamSourceSnapshot {
		const state = this._stateFor(source);
		const status = state.records.get(UPSTREAM_SOURCE_STATUS_ID);
		return {
			source: source,
			status: status?.status ?? "missing",
			models: [...state.records.keys()].filter((id) => id !== UPSTREAM_SOURCE_STATUS_ID).length,
			fetchedAt: status?.fetchedAt.toISOString(),
			expiresAt: status?.expiresAt.toISOString(),
			error: status?.error ?? state.lastError,
			refreshing: state.refreshing,
		};
	}

	/** 全部来源快照。 */
	snapshots(): readonly UpstreamSourceSnapshot[] {
		return this._sources.map((source) => this.snapshot(source));
	}

	/** 刷新所有已过期或从未拉取过的来源（并发，不抛错）。 */
	async refreshExpired(): Promise<void> {
		const now = this._now();
		const tasks = this._sources
			.filter((source) => isExpired(this._stateFor(source).records.get(UPSTREAM_SOURCE_STATUS_ID), now))
			.map((source) => this.refresh(source));
		await Promise.allSettled(tasks);
	}

	/**
	 * 刷新单个来源。并发调用共享同一个在途 Promise。
	 * @param source - 来源
	 */
	async refresh(source: SubscriptionSource): Promise<void> {
		const existing = this._inflight.get(source);
		if (existing !== undefined) {
			return existing;
		}
		const task = this._refreshOnce(source).finally(() => {
			this._inflight.delete(source);
		});
		this._inflight.set(source, task);
		return task;
	}

	/**
	 * 安排一次后台刷新。
	 * @param source - 来源
	 */
	private _scheduleRefresh(source: SubscriptionSource): void {
		if (this._inflight.has(source)) {
			return;
		}
		// 同一来源的最小重试间隔：并发请求或一次页面加载里的多个部署只会合并成一次回源。
		const now = this._now();
		const last = this._lastAttemptAt.get(source);
		if (last !== undefined && now - last < UPSTREAM_META_MIN_REFRESH_INTERVAL_MS) {
			return;
		}
		this._lastAttemptAt.set(source, now);
		void this.refresh(source).catch((error: unknown) => {
			this._logger.warn("上游模型元信息刷新失败", {
				source: source,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}

	/**
	 * 一次完整刷新：选账号 → 拉取 → 解析 → 落库 → 更新内存。
	 * @param source
	 */
	private async _refreshOnce(source: SubscriptionSource): Promise<void> {
		const state = this._stateFor(source);
		if (state.refreshing) {
			return;
		}
		state.refreshing = true;
		const startedAt = this._now();
		try {
			const adapter = this._adapters.get(source);
			if (adapter === undefined || !adapter.supported) {
				await this._persistSourceStatus(source, "unsupported", undefined, "该上游不提供模型元信息接口", this._ttlMs);
				return;
			}
			const accounts = (await this._accounts.list(source)).filter((account) => !account.disabled);
			if (accounts.length === 0) {
				await this._persistSourceStatus(source, "error", undefined, `没有可用的 ${source} 账号`, this._errorTtlMs);
				return;
			}
			const candidates = accounts.filter((account) => adapter.hasCredential(account));
			if (candidates.length === 0) {
				await this._persistSourceStatus(source, "error", undefined, `${source} 账号缺少元信息请求所需的凭据`, this._errorTtlMs);
				return;
			}
			let lastError = "上游未返回目录";
			for (const account of candidates.slice(0, 3)) {
				try {
					const entries = await adapter.list({
						account: account,
						fetchImpl: this._fetchImpl,
						timeoutMs: this._fetchTimeoutMs,
					});
					if (entries === null || entries.length === 0) {
						lastError = "上游返回空模型列表";
						continue;
					}
					await this._persistCatalog(source, adapter, entries, startedAt);
					this._logger.info("上游模型元信息已刷新", {
						source: source,
						models: entries.length,
						elapsedMs: this._now() - startedAt,
					});
					return;
				} catch (error) {
					lastError = error instanceof Error ? error.message : String(error);
				}
			}
			await this._persistSourceStatus(source, "error", undefined, lastError, this._errorTtlMs);
		} catch (error) {
			// 落库失败不能让后台刷新变成未处理的 rejection：内存里已拿到的数据照常服务，
			// 下次巡检会再试。
			this._logger.warn("上游模型元信息刷新未完成", {
				source: source,
				error: error instanceof Error ? error.message : String(error),
			});
		} finally {
			state.refreshing = false;
		}
	}

	/**
	 * 写入一次成功的拉取结果。
	 * @param source - 来源
	 * @param adapter - 适配器
	 * @param entries - 原始条目
	 * @param startedAt - 开始时间（毫秒）
	 */
	private async _persistCatalog(
		source: SubscriptionSource,
		adapter: UpstreamSourceAdapter,
		entries: readonly unknown[],
		startedAt: number,
	): Promise<void> {
		const expiresAt = new Date(startedAt + this._ttlMs);
		const fetchedAt = new Date(startedAt);
		const parsed = adapter.parse(entries);
		const sourceRow: UpstreamModelMetaRecord = {
			source: source,
			modelId: UPSTREAM_SOURCE_STATUS_ID,
			status: "ok",
			displayName: undefined,
			metadata: undefined,
			error: undefined,
			fetchedAt: fetchedAt,
			expiresAt: expiresAt,
		};
		const writes: UpstreamModelMetaWrite[] = [];
		const rawById = new Map<string, unknown>();
		for (const entry of entries) {
			const id = upstreamEntryId(entry);
			if (id !== undefined && !rawById.has(id)) {
				rawById.set(id, slimRawEntry(entry));
			}
		}
		for (const [modelId, metadata] of parsed) {
			writes.push({
				source: source,
				modelId: modelId,
				status: "ok",
				displayName: metadata.displayName,
				metadata: metadata,
				raw: rawById.get(modelId),
				fetchedAt: fetchedAt,
				expiresAt: expiresAt,
			});
		}
		for (const id of rawById.keys()) {
			if (parsed.has(id)) {
				continue;
			}
			// 上游列出了这个模型但解析不出任何元信息：保留一行空 metadata，仍然算「上游见过」。
			writes.push({ source: source, modelId: id, status: "ok", raw: rawById.get(id), fetchedAt: fetchedAt, expiresAt: expiresAt });
		}
		await this._repository.replaceSource(source, writes);
		// 来源级状态单独落一行（model_id = "*"），让重启后仍能判断「最近拉过」而不必立刻回源。
		await this._repository.upsert(sourceRow);
		const state = this._stateFor(source);
		state.records.clear();
		state.records.set(UPSTREAM_SOURCE_STATUS_ID, sourceRow);
		for (const write of writes) {
			state.records.set(write.modelId, {
				source: write.source,
				modelId: write.modelId,
				status: write.status,
				displayName: write.displayName,
				metadata: write.metadata,
				raw: write.raw,
				error: write.error,
				fetchedAt: write.fetchedAt,
				expiresAt: write.expiresAt,
			});
		}
		state.lastError = undefined;
	}

	/**
	 * 写入来源级状态行（负缓存）。
	 * @param source - 来源
	 * @param status - 状态
	 * @param metadata - 可选的归一化字段
	 * @param error - 原因
	 * @param ttlMs - 过期时间
	 */
	private async _persistSourceStatus(
		source: SubscriptionSource,
		status: "unsupported" | "error",
		metadata: UpstreamModelMetadata | undefined,
		error: string,
		ttlMs: number,
	): Promise<void> {
		const now = this._now();
		const record: UpstreamModelMetaRecord = {
			source: source,
			modelId: UPSTREAM_SOURCE_STATUS_ID,
			status: status,
			metadata: metadata,
			error: error,
			fetchedAt: new Date(now),
			expiresAt: new Date(now + ttlMs),
		};
		await this._repository.upsert({
			source: record.source,
			modelId: record.modelId,
			status: record.status,
			metadata: record.metadata,
			error: record.error,
			fetchedAt: record.fetchedAt,
			expiresAt: record.expiresAt,
		});
		const state = this._stateFor(source);
		state.records.set(UPSTREAM_SOURCE_STATUS_ID, record);
		state.lastError = error;
	}

	private _stateFor(source: SubscriptionSource): SourceState {
		const existing = this._state.get(source);
		if (existing !== undefined) {
			return existing;
		}
		const created: SourceState = { records: new Map(), refreshing: false };
		this._state.set(source, created);
		return created;
	}

	private _startTimer(): void {
		if (this._timer !== undefined) {
			return;
		}
		this._timer = this._setIntervalImpl(() => {
			void this.refreshExpired().catch((error: unknown) => {
				this._logger.warn("上游模型元信息巡检失败", { error: error instanceof Error ? error.message : String(error) });
			});
		}, this._sweepIntervalMs);
		this._timer.unref?.();
	}
}

/**
 * 从原始条目里取上游模型 ID；用于保留「上游见过但解析不出元信息」的行。
 * @param entry
 */
function upstreamEntryId(entry: unknown): string | undefined {
	if (typeof entry !== "object" || entry === null) {
		return undefined;
	}
	const record = entry as Record<string, unknown>;
	for (const key of ["id", "slug", "name", "model"]) {
		const value = record[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	}
	return undefined;
}
