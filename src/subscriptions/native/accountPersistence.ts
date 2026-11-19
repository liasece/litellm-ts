/**
 * 订阅账号持久化契约。
 *
 * 账号正文存在数据库里（`LiteLLM_SubscriptionAccount.payload`），有效性由
 * `trashed_at` 决定。这一层只描述「读写一行账号」，不关心 token 语义、来源适配或
 * 调度；数据库实现见 `src/repositories/SubscriptionAccountRepository.ts`。
 *
 * 内存实现只服务测试与快速装配：它不落盘，进程退出即丢，不能用于生产。
 */

import type { SubscriptionSource } from "./types";

/** 一行订阅账号。 */
export interface StoredSubscriptionAccount {
	/** 稳定账号 ID。 */
	readonly id: string;
	/** 订阅来源。 */
	readonly source: SubscriptionSource;
	/** 来源内账号键（沿用旧 auth 文件名）。 */
	readonly key: string;
	/** 旧 auth JSON 原文。 */
	readonly payload: Record<string, unknown>;
	/** 回收站时间；为空即有效。 */
	readonly trashedAt: Date | null;
	/** 创建时间。 */
	readonly createdAt: Date;
	/** 最近写入时间。 */
	readonly updatedAt: Date;
}

/** 新账号行。 */
export interface NewStoredSubscriptionAccount {
	/** 稳定账号 ID。 */
	readonly id: string;
	/** 订阅来源。 */
	readonly source: SubscriptionSource;
	/** 来源内账号键。 */
	readonly key: string;
	/** 旧 auth JSON 原文。 */
	readonly payload: Record<string, unknown>;
	/** 回收站时间；导入回收站文件时传入。 */
	readonly trashedAt?: Date | null;
}

/** 已有账号行的可变字段。 */
export interface StoredSubscriptionAccountPatch {
	/** 新的 auth JSON 原文。 */
	readonly payload?: Record<string, unknown>;
	/** 新的回收站时间；`null` 表示恢复为有效账号。 */
	readonly trashedAt?: Date | null;
}

/** 账号持久化接口。 */
export interface SubscriptionAccountPersistence {
	/**
	 * 列出账号，包含回收站。
	 * @param source - 可选来源过滤
	 */
	list(source?: SubscriptionSource): Promise<StoredSubscriptionAccount[]>;

	/**
	 * 按账号 ID 读取。
	 * @param id - 稳定账号 ID
	 */
	find(id: string): Promise<StoredSubscriptionAccount | undefined>;

	/**
	 * 按来源与账号键读取；回收站行与有效行可能同时存在。
	 * @param source - 订阅来源
	 * @param key - 账号键
	 */
	findByKey(source: SubscriptionSource, key: string): Promise<StoredSubscriptionAccount[]>;

	/**
	 * 插入账号；账号 ID 已存在时抛出冲突。
	 * @param row - 新账号行
	 */
	insert(row: NewStoredSubscriptionAccount): Promise<void>;

	/**
	 * 更新账号；不存在时返回 undefined。
	 * @param id - 稳定账号 ID
	 * @param patch - 待更新字段
	 */
	update(id: string, patch: StoredSubscriptionAccountPatch): Promise<StoredSubscriptionAccount | undefined>;

	/**
	 * 删除账号；不存在时静默返回。
	 * @param id - 稳定账号 ID
	 */
	remove(id: string): Promise<void>;
}

/**
 * 内存持久化，仅供测试与本地装配使用。
 *
 * 行为与数据库实现保持一致（唯一键、时间戳、回收站字段），避免测试跑在与生产不同的
 * 语义上。
 */
export class MemorySubscriptionAccountPersistence implements SubscriptionAccountPersistence {
	private readonly _rows = new Map<string, StoredSubscriptionAccount>();

	/**
	 * @param seed - 起始行
	 */
	constructor(seed: readonly NewStoredSubscriptionAccount[] = []) {
		for (const row of seed) {
			const now = new Date();
			this._rows.set(row.id, {
				id: row.id,
				source: row.source,
				key: row.key,
				payload: row.payload,
				trashedAt: row.trashedAt ?? null,
				createdAt: now,
				updatedAt: now,
			});
		}
	}

	/**
	 * @param source - 可选来源过滤
	 */
	async list(source?: SubscriptionSource): Promise<StoredSubscriptionAccount[]> {
		return [...this._rows.values()].filter((row) => source === undefined || row.source === source);
	}

	/**
	 * @param id - 稳定账号 ID
	 */
	async find(id: string): Promise<StoredSubscriptionAccount | undefined> {
		return this._rows.get(id);
	}

	/**
	 * @param source - 订阅来源
	 * @param key - 账号键
	 */
	async findByKey(source: SubscriptionSource, key: string): Promise<StoredSubscriptionAccount[]> {
		return [...this._rows.values()].filter((row) => row.source === source && row.key === key);
	}

	/**
	 * @param row - 新账号行
	 * @throws {Error} 账号 ID 或 (来源, 账号键) 重复
	 */
	async insert(row: NewStoredSubscriptionAccount): Promise<void> {
		if (this._rows.has(row.id)) {
			throw new Error(`duplicate account id: ${row.id}`);
		}
		const sameKey = await this.findByKey(row.source, row.key);
		if ((row.trashedAt ?? null) === null && sameKey.some((existing) => existing.trashedAt === null)) {
			throw new Error(`duplicate active account key: ${row.source}/${row.key}`);
		}
		const now = new Date();
		this._rows.set(row.id, {
			id: row.id,
			source: row.source,
			key: row.key,
			payload: row.payload,
			trashedAt: row.trashedAt ?? null,
			createdAt: now,
			updatedAt: now,
		});
	}

	/**
	 * @param id - 稳定账号 ID
	 * @param patch - 待更新字段
	 */
	async update(id: string, patch: StoredSubscriptionAccountPatch): Promise<StoredSubscriptionAccount | undefined> {
		const current = this._rows.get(id);
		if (!current) {
			return undefined;
		}
		const trashedAt = patch.trashedAt === undefined ? current.trashedAt : patch.trashedAt;
		if (trashedAt === null && current.trashedAt !== null) {
			const sameKey = await this.findByKey(current.source, current.key);
			if (sameKey.some((existing) => existing.id !== id && existing.trashedAt === null)) {
				throw new Error(`duplicate active account key: ${current.source}/${current.key}`);
			}
		}
		const next: StoredSubscriptionAccount = {
			...current,
			payload: patch.payload ?? current.payload,
			trashedAt: trashedAt,
			updatedAt: new Date(),
		};
		this._rows.set(id, next);
		return next;
	}

	/**
	 * @param id - 稳定账号 ID
	 */
	async remove(id: string): Promise<void> {
		this._rows.delete(id);
	}
}
