/**
 * 内存登录会话缓存。
 *
 * 登录是短生命周期状态：会话只保存在进程内，带 TTL 与总量上限，避免仪表盘
 * 反复发起登录后无限增长。token 与 PKCE/设备码等私有状态放在 payload 中，
 * 不进入对外快照。
 */

import { randomUUID } from "node:crypto";
import { ApiError } from "../../../core/api/ApiError";
import type { SubscriptionLoginSession, SubscriptionLoginState } from "../types";

/**
 * 保存在缓存中的一条会话。
 * @template TPayload - 处理器私有状态类型
 */
export interface LoginSessionRecord<TPayload> {
	/** 对外快照。 */
	readonly session: SubscriptionLoginSession;
	/** 处理器私有状态。 */
	readonly payload: TPayload;
	/** 过期时间（毫秒时间戳）。 */
	readonly expiresAt: number;
}

/** 构造参数。 */
export interface LoginSessionRegistryOptions {
	/** 会话 TTL（毫秒）。 */
	readonly ttlMs: number;
	/** 同时保留的会话数量上限。 */
	readonly maxEntries: number;
	/** 当前时间（毫秒）；测试注入。 */
	readonly now?: () => number;
}

/** 新建会话时对外展示的字段。 */
export interface LoginSessionInit {
	/** 需要用户打开的 URL。 */
	readonly url?: string;
	/** 终端式输出行。 */
	readonly output?: readonly string[];
	/** 需要用户输入的提示。 */
	readonly prompt?: string;
}

/** 更新会话时整体替换的字段。 */
export interface LoginSessionPatch {
	/** 新状态。 */
	readonly state: SubscriptionLoginState;
	/** 终端式输出行。 */
	readonly output: readonly string[];
	/** 需要用户打开的 URL。 */
	readonly url?: string;
	/** 需要用户输入的提示。 */
	readonly prompt?: string;
	/** 失败原因。 */
	readonly error?: string;
}

/**
 * 有界登录会话表；按插入顺序淘汰最旧会话。
 * @template TPayload - 处理器私有状态类型
 */
export class LoginSessionRegistry<TPayload> {
	private readonly _ttlMs: number;
	private readonly _maxEntries: number;
	private readonly _now: () => number;
	private readonly _entries = new Map<string, LoginSessionRecord<TPayload>>();

	constructor(options: LoginSessionRegistryOptions) {
		this._ttlMs = options.ttlMs;
		this._maxEntries = Math.max(1, options.maxEntries);
		this._now = options.now ?? (() => Date.now());
	}

	/** 当前保留的会话数量（已剔除过期项）。 */
	get size(): number {
		this._sweep();
		return this._entries.size;
	}

	/**
	 * 新建 pending 会话。
	 * @param payload - 处理器私有状态
	 * @param init - 展示字段
	 */
	create(payload: TPayload, init: LoginSessionInit = {}): LoginSessionRecord<TPayload> {
		this._sweep();
		while (this._entries.size >= this._maxEntries) {
			const oldest = this._entries.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this._entries.delete(oldest);
		}
		const session: SubscriptionLoginSession = {
			id: randomUUID(),
			state: "pending",
			output: [...(init.output ?? [])],
			...(init.url !== undefined ? { url: init.url } : {}),
			...(init.prompt !== undefined ? { prompt: init.prompt } : {}),
		};
		const record: LoginSessionRecord<TPayload> = {
			session: session,
			payload: payload,
			expiresAt: this._now() + this._ttlMs,
		};
		this._entries.set(session.id, record);
		return record;
	}

	/**
	 * 读取会话；不存在或已过期时返回 undefined。
	 * @param id - 会话 ID
	 */
	find(id: string): LoginSessionRecord<TPayload> | undefined {
		const record = this._entries.get(id);
		if (!record) {
			return undefined;
		}
		if (record.expiresAt <= this._now()) {
			this._entries.delete(id);
			return undefined;
		}
		return record;
	}

	/**
	 * 更新会话；未提供的可选字段会被清除。
	 * @param id - 会话 ID
	 * @param patch - 新状态与展示字段
	 * @param payload - 可选的私有状态替换
	 * @throws {ApiError} 会话不存在或已过期时抛出
	 */
	update(id: string, patch: LoginSessionPatch, payload?: TPayload): LoginSessionRecord<TPayload> {
		const record = this.find(id);
		if (!record) {
			throw ApiError.notFound("登录会话不存在或已过期，请重新开始");
		}
		const session: SubscriptionLoginSession = {
			id: record.session.id,
			state: patch.state,
			output: [...patch.output],
			...(patch.url !== undefined ? { url: patch.url } : {}),
			...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
			...(patch.error !== undefined ? { error: patch.error } : {}),
		};
		const next: LoginSessionRecord<TPayload> = {
			session: session,
			payload: payload === undefined ? record.payload : payload,
			expiresAt: record.expiresAt,
		};
		this._entries.set(id, next);
		return next;
	}

	/**
	 * 仅替换处理器私有状态，保持对外会话不变。
	 * @param id - 会话 ID
	 * @param payload - 新私有状态
	 * @throws {ApiError} 会话不存在或已过期时抛出
	 */
	replacePayload(id: string, payload: TPayload): void {
		const record = this.find(id);
		if (!record) {
			throw ApiError.notFound("登录会话不存在或已过期，请重新开始");
		}
		this._entries.set(id, { session: record.session, payload: payload, expiresAt: record.expiresAt });
	}

	/**
	 * 删除会话。
	 * @param id - 会话 ID
	 */
	remove(id: string): void {
		this._entries.delete(id);
	}

	/** 清理过期会话。 */
	private _sweep(): void {
		const nowMs = this._now();
		for (const [id, record] of this._entries) {
			if (record.expiresAt <= nowMs) {
				this._entries.delete(id);
			}
		}
	}
}
