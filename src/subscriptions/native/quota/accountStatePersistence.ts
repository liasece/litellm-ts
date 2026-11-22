/**
 * 订阅账号调度状态的持久化契约。
 *
 * 调度状态（最近失败时间、额度耗尽的截止时间）原先只活在进程内存里：容器一重启，
 * 冷却和「这个账号这周没额度」的事实全部丢失，之后每个请求都要用真实失败重新探一遍。
 * 2026-11-19 22:49 那次发布后本可以立刻跳过三个空账号，却先从零开始撞墙。
 *
 * 这里只描述「读全部、写一批」两件事，数据库实现见
 * `src/repositories/SubscriptionAccountStateRepository.ts`；内存实现只服务测试。
 */

import type { SubscriptionSource } from "../types";

/** 一个账号的调度状态。 */
export interface StoredAccountState {
	/** 账号 ID。 */
	readonly accountId: string;
	/** 订阅来源。 */
	readonly source: SubscriptionSource;
	/** 最近一次失败时间（毫秒时间戳）。 */
	readonly lastFailureAt?: number;
	/** 额度耗尽的截止时间（毫秒时间戳）。 */
	readonly exhaustedUntil?: number;
	/** 额度耗尽原因。 */
	readonly reason?: string;
}

/** 调度状态持久化接口。 */
export interface SubscriptionAccountStatePersistence {
	/** 读取全部状态。 */
	list(): Promise<StoredAccountState[]>;
	/**
	 * 写入一批状态；同一账号按 accountId 覆盖。
	 * @param states - 待写入状态
	 */
	upsert(states: readonly StoredAccountState[]): Promise<void>;
}

/** 内存实现；只用于测试与未装配数据库的场景。 */
export class MemorySubscriptionAccountStatePersistence implements SubscriptionAccountStatePersistence {
	private readonly _rows = new Map<string, StoredAccountState>();

	/** 读取全部内存状态。 */
	async list(): Promise<StoredAccountState[]> {
		return [...this._rows.values()];
	}

	/**
	 * 覆盖写入状态。
	 * @param states - 待写入状态
	 */
	async upsert(states: readonly StoredAccountState[]): Promise<void> {
		for (const state of states) {
			this._rows.set(state.accountId, state);
		}
	}
}
