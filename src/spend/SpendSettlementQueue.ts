/**
 * 结算写队列。
 *
 * 请求结束后的记账（SpendLogs 落行 + key/user/team/daily 计数）过去在响应路径上同步
 * 执行：非流式端点甚至会等记账提交后才 `res.json`，流式端点则让连接多挂几十到几百
 * 毫秒。对调用方来说，账本落库的延迟不影响响应内容，完全可以挪到进程内的后台批量写。
 *
 * 语义约定：
 * - `queueSpendLog` 只入队、立即返回；写失败不向请求路径抛错（记账失败会重试）。
 * - 队列按入队顺序串行写，单条失败原地重试并退避，不跳过、不乱序。
 * - 队列按条数封顶；超过上限时入队调用改为直接同步写这一条（相当于退化为旧行为），
 *   用请求侧变慢换「不丢账」。
 * - 进程退出前调用 `flushSpendSettlementQueue`，把剩余条目写完（有超时上限）。
 */

import { createModuleLogger } from "../core/utils/logger";
import { spendSettlementPending, spendSettlementWrites } from "../observability/MetricCatalog";
import type { DrizzleDb } from "../core/db/Database";
import type { SpendLog } from "../types/spend";
import { trackSpendLog } from "./SpendTracker";

const logger = createModuleLogger("SpendSettlementQueue");

/** 空闲时最多攒这么久再写，决定「响应结束 → 账本可见」的上限。 */
export const DEFAULT_SPEND_SETTLEMENT_FLUSH_MS = 250;

/** 队列里攒到这个条数就立刻冲刷，避免突发流量把延迟堆到窗口上限。 */
export const DEFAULT_SPEND_SETTLEMENT_BATCH = 25;

/** 队列条数上限；超过后新条目在入队调用里同步写掉。 */
export const DEFAULT_SPEND_SETTLEMENT_MAX_PENDING = 200;

/** 单条失败后的退避上限。 */
const MAX_RETRY_DELAY_MS = 10_000;

/**
 * 让出事件循环；flush 的退避等待也用它。
 * @param ms - 等待毫秒数
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PendingSettlement {
	readonly db: DrizzleDb;
	readonly logEntry: SpendLog;
	attempts: number;
}

/** 结算队列的可调参数；默认值按线上流量特征选取。 */
export interface SpendSettlementQueueOptions {
	/** 空闲冲刷窗口（毫秒）。 */
	flushIntervalMs?: number;
	/** 达到该条数立即冲刷。 */
	batchSize?: number;
	/** 允许积压的最大条数。 */
	maxPending?: number;
	/**
	 * 是否同步写（入队即落库）。默认在测试环境开启，让既有断言保持「调用即发生」；
	 * 生产走队列。队列自身的异步行为由 SpendSettlementQueue 单测覆盖。
	 */
	immediate?: boolean;
	/** 单条失败后的首次退避（毫秒）；测试用它把等待压到毫秒级。 */
	retryBaseDelayMs?: number;
	/** 单条失败后的退避上限（毫秒）。 */
	maxRetryDelayMs?: number;
}

/**
 * 进程级结算队列；单实例对应单进程，测试可直接 new 一个隔离实例。
 */
export class SpendSettlementQueue {
	private readonly _queue: PendingSettlement[] = [];
	private readonly _flushIntervalMs: number;
	private readonly _batchSize: number;
	private readonly _maxPending: number;
	private readonly _immediate: boolean;
	private readonly _retryBaseDelayMs: number;
	private readonly _maxRetryDelayMs: number;
	private _timer: ReturnType<typeof setTimeout> | undefined;
	private _timerDueAt = 0;
	private _draining = false;
	private _closed = false;
	private _retryAt = 0;
	private _completed = 0;
	private _failed = 0;

	constructor(options: SpendSettlementQueueOptions = {}) {
		this._flushIntervalMs = options.flushIntervalMs ?? DEFAULT_SPEND_SETTLEMENT_FLUSH_MS;
		this._batchSize = Math.max(1, options.batchSize ?? DEFAULT_SPEND_SETTLEMENT_BATCH);
		this._maxPending = Math.max(1, options.maxPending ?? DEFAULT_SPEND_SETTLEMENT_MAX_PENDING);
		this._immediate = options.immediate ?? process.env.NODE_ENV === "test";
		this._retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
		this._maxRetryDelayMs = options.maxRetryDelayMs ?? MAX_RETRY_DELAY_MS;
	}

	/** 当前积压条数；用于诊断与测试。 */
	get pending(): number {
		return this._queue.length;
	}

	/** 已成功落库条数；用于诊断与测试。 */
	get completed(): number {
		return this._completed;
	}

	/** 累计失败次数（含重试）；用于诊断与测试。 */
	get failed(): number {
		return this._failed;
	}

	/** 拒绝新条目；退出前由 flush 负责清空残留。 */
	close(): void {
		this._closed = true;
		this._clearTimer();
	}

	/**
	 * 入队一条待结算账目。只做入队与调度，立即 resolve。
	 *
	 * 队列满时退化为「在本次调用里同步写完这一条」：调用方通常不 await 返回值，
	 * 因此不会阻塞响应，只是把内存压力换成本次写库。
	 * @param db - 数据库实例
	 * @param logEntry - 已构造好的 SpendLog
	 */
	async enqueue(db: DrizzleDb, logEntry: SpendLog): Promise<void> {
		if (this._immediate) {
			await this._writeOne({ db: db, logEntry: logEntry, attempts: 0 });
			return;
		}
		if (this._closed) {
			// 关闭后仍收到的账目直接写，不再进队列。
			await this._writeOne({ db: db, logEntry: logEntry, attempts: 0 });
			return;
		}
		if (this._queue.length >= this._maxPending) {
			logger.warn("结算队列已满，改为同步写", { pending: this._queue.length, requestId: logEntry.request_id });
			spendSettlementWrites.inc({ outcome: "overflow" });
			await this._writeOne({ db: db, logEntry: logEntry, attempts: 0 });
			return;
		}
		this._queue.push({ db: db, logEntry: logEntry, attempts: 0 });
		spendSettlementPending.set(this._queue.length);
		if (this._queue.length >= this._batchSize) {
			this._schedule(0);
			return;
		}
		this._schedule(this._flushIntervalMs);
	}

	/**
	 * 等待队列清空；用于优雅退出。
	 * @param timeoutMs - 最长等待时间
	 * @returns 是否在超时前清空
	 */
	async flush(timeoutMs = 5000): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		this._clearTimer();
		while (this._queue.length > 0) {
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				logger.warn("结算队列在退出前未清空", { pending: this._queue.length, completed: this._completed });
				return false;
			}
			const backoffWait = this._retryAt - Date.now();
			if (backoffWait > 0) {
				await sleep(Math.min(backoffWait, remaining));
				continue;
			}
			await this._drainOnce();
			if (this._queue.length > 0 && this._retryAt <= Date.now()) {
				// 没有可用的重试时间却又没清空：给出队循环一个让出事件循环的机会，
				// 避免 flush 在单次 drain 内忙等。
				await sleep(0);
			}
		}
		return true;
	}

	/** 清空内存状态；仅测试使用。 */
	reset(): void {
		this._queue.length = 0;
		this._clearTimer();
		this._draining = false;
		this._closed = false;
		this._retryAt = 0;
		this._completed = 0;
		this._failed = 0;
	}

	private _schedule(delayMs: number): void {
		if (this._draining) {
			return;
		}
		const wait = Math.max(delayMs, this._retryAt - Date.now(), 0);
		const dueAt = Date.now() + wait;
		// 已有更早的定时器就让它跑；这次要求更早时才替换，避免「批量阈值触发」被
		// 之前的窗口定时器压住。
		if (this._timer !== undefined) {
			if (dueAt >= this._timerDueAt) {
				return;
			}
			clearTimeout(this._timer);
		}
		this._timerDueAt = dueAt;
		this._timer = setTimeout(() => {
			this._timer = undefined;
			this._timerDueAt = 0;
			void this._drainOnce();
		}, wait);
		this._timer.unref?.();
	}

	private async _drainOnce(): Promise<void> {
		if (this._draining) {
			return;
		}
		this._draining = true;
		try {
			while (this._queue.length > 0) {
				const head = this._queue[0];
				if (head === undefined) {
					break;
				}
				if (this._retryAt > Date.now()) {
					break;
				}
				this._queue.shift();
				try {
					await trackSpendLog(head.db, head.logEntry);
					this._completed += 1;
					spendSettlementPending.set(this._queue.length);
					spendSettlementWrites.inc({ outcome: "written" });
					this._retryAt = 0;
				} catch (error) {
					// 记账失败不能丢：放回队首，退避后重试。
					head.attempts += 1;
					this._failed += 1;
					spendSettlementWrites.inc({ outcome: "failed" });
					this._queue.unshift(head);
					const backoff = Math.min(this._maxRetryDelayMs, this._retryBaseDelayMs * 2 ** Math.min(head.attempts - 1, 4));
					this._retryAt = Date.now() + backoff;
					logger.error("结算写库失败，已排队重试", {
						error: error instanceof Error ? error.message : String(error),
						requestId: head.logEntry.request_id,
						attempts: head.attempts,
						backoffMs: backoff,
					});
					break;
				}
			}
		} finally {
			this._draining = false;
			spendSettlementPending.set(this._queue.length);
			if (this._queue.length > 0) {
				this._schedule(this._flushIntervalMs);
			}
		}
	}

	private async _writeOne(entry: PendingSettlement): Promise<void> {
		try {
			await trackSpendLog(entry.db, entry.logEntry);
			this._completed += 1;
		} catch (error) {
			// 队列满时的同步兜底：失败仍然放回队列，交给后台重试。
			// immediate 模式（测试）不重排队：重试定时器会跨测试用例继续调用假实现。
			this._failed += 1;
			if (this._immediate) {
				logger.error("结算同步写失败", {
					error: error instanceof Error ? error.message : String(error),
					requestId: entry.logEntry.request_id,
				});
				return;
			}
			entry.attempts += 1;
			this._queue.unshift(entry);
			this._retryAt = Date.now() + Math.min(this._maxRetryDelayMs, this._retryBaseDelayMs * 2 ** Math.min(entry.attempts - 1, 4));
			logger.error("结算同步兜底失败，已排队重试", {
				error: error instanceof Error ? error.message : String(error),
				requestId: entry.logEntry.request_id,
			});
			this._schedule(this._flushIntervalMs);
		}
	}

	private _clearTimer(): void {
		if (this._timer !== undefined) {
			clearTimeout(this._timer);
			this._timer = undefined;
		}
		this._timerDueAt = 0;
	}
}

/** 进程级结算队列。 */
export const spendSettlementQueue = new SpendSettlementQueue();

/**
 * 把一条账目交给后台队列；立即返回，不阻塞响应。
 * @param db - 数据库实例
 * @param logEntry - 已构造好的 SpendLog
 */
export async function queueSpendLog(db: DrizzleDb, logEntry: SpendLog): Promise<void> {
	await spendSettlementQueue.enqueue(db, logEntry);
}

/**
 * 优雅退出前清空结算队列。
 * @param timeoutMs - 最长等待时间
 */
export async function flushSpendSettlementQueue(timeoutMs = 5000): Promise<boolean> {
	return spendSettlementQueue.flush(timeoutMs);
}
