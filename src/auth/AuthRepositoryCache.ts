/**
 * 鉴权仓储读缓存。
 *
 * 鉴权链每请求要串行读若干次同一批实体（token、team、user、membership、budget…），
 * 这些行在一次请求里只读、且绝大多数在毫秒级窗口内不会变。缓存放在仓储层而不是
 * 中间件层，好处是：所有读路径（HTTP 鉴权、AuthorizationGuard、WebUI 会话校验）
 * 自动共享同一份快照，写法与未缓存时完全一致。
 *
 * 失效模型（对应「没有延迟生效的缺点」）：
 * - 仓储自身的写方法（注销、续期）在写入后立刻删对应 key；
 * - 记账提交后按主体失效（token/user/team/membership/org/project/end-user），
 *   预算检查读到的是上一次提交后的 spend，而不是缓存里更早的旧值；
 * - 管理端点改/删 key 时按 tag 失效，删号/封号立即生效，不依赖 TTL 过期；
 * - TTL 只是兜底：本进程之外（其他实例、直接改库）的变更最多延迟一个 TTL。
 *
 * 负结果（不存在）不缓存：遍历式无效 token 探测不应该把缓存撑大，也不应该让刚
 * 创建的 key 在 TTL 内不可用。
 */

import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("AuthRepositoryCache");

/** 默认 TTL：足够覆盖同一波并发请求与 UI 轮询，又能让跨实例变更在一秒级收敛。 */
export const DEFAULT_AUTH_REPOSITORY_CACHE_TTL_MS = 3000;

/** 单进程缓存条目上限，避免无效 token 探测把内存顶起来。 */
export const DEFAULT_AUTH_REPOSITORY_CACHE_MAX_ENTRIES = 4096;

/** 运维可在不重建镜像的情况下关闭/调整缓存。 */
export const AUTH_REPOSITORY_CACHE_TTL_ENV = "LITELLM_AUTH_REPOSITORY_CACHE_TTL_MS";

/**
 * 解析缓存 TTL；非法输入回落到默认值，0 表示关闭缓存。
 * @param raw - 环境变量原文
 */
export function resolveAuthRepositoryCacheTtlMs(raw: string | undefined): number {
	if (raw === undefined || raw.trim() === "") {
		return DEFAULT_AUTH_REPOSITORY_CACHE_TTL_MS;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) {
		return DEFAULT_AUTH_REPOSITORY_CACHE_TTL_MS;
	}
	return Math.round(parsed);
}

interface CacheEntry {
	readonly value: unknown;
	readonly expiresAt: number;
	readonly tags: readonly string[];
}

/**
 * 带 TTL、容量上限与 tag 失效的简单缓存；按插入顺序淘汰最旧条目。
 */
export class AuthRepositoryCache {
	private readonly _entries = new Map<string, CacheEntry>();
	private readonly _ttlMs: number;
	private readonly _maxEntries: number;
	private readonly _now: () => number;

	constructor(options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}) {
		this._ttlMs = options.ttlMs ?? resolveAuthRepositoryCacheTtlMs(process.env[AUTH_REPOSITORY_CACHE_TTL_ENV]);
		this._maxEntries = options.maxEntries ?? DEFAULT_AUTH_REPOSITORY_CACHE_MAX_ENTRIES;
		this._now = options.now ?? Date.now;
	}

	/** 缓存是否生效。 */
	get enabled(): boolean {
		return this._ttlMs > 0;
	}

	/** 当前条目数；用于诊断与测试。 */
	get size(): number {
		return this._entries.size;
	}

	/**
	 * 读取缓存；命中时顺带刷新 LRU 位置。
	 * @param key - 缓存键
	 */
	get<T>(key: string): T | undefined {
		if (!this.enabled) {
			return undefined;
		}
		const entry = this._entries.get(key);
		if (entry === undefined) {
			return undefined;
		}
		if (entry.expiresAt <= this._now()) {
			this._entries.delete(key);
			return undefined;
		}
		// Map 保持插入序：删掉再放回即最近使用在最前，淘汰从最旧开始。
		this._entries.delete(key);
		this._entries.set(key, entry);
		return entry.value as T;
	}

	/**
	 * 写入缓存。value 为 null 时不写（负结果不缓存）。
	 * @param key - 缓存键
	 * @param value - 实体行
	 * @param tags - 失效标签（如 user:<id>、team:<id>）
	 */
	set(key: string, value: unknown, tags: readonly string[] = []): void {
		if (!this.enabled || value === null || value === undefined) {
			return;
		}
		if (this._entries.size >= this._maxEntries) {
			const oldest = this._entries.keys().next();
			if (!oldest.done) {
				this._entries.delete(oldest.value);
			}
		}
		this._entries.set(key, { value: value, expiresAt: this._now() + this._ttlMs, tags: tags });
	}

	/**
	 * 删除单个键。
	 * @param key - 缓存键
	 */
	delete(key: string): void {
		this._entries.delete(key);
	}

	/**
	 * 按标签失效（例如某个用户/团队下的全部实体）。
	 * @param tag - 失效标签
	 */
	deleteByTag(tag: string): void {
		for (const [key, entry] of this._entries) {
			if (entry.tags.includes(tag)) {
				this._entries.delete(key);
			}
		}
	}

	/** 清空缓存；用于测试或运行期重置。 */
	clear(): void {
		this._entries.clear();
	}
}

/** 进程级共享缓存：仓储读、记账写、管理端点写都操作同一份。 */
export const authRepositoryCache = new AuthRepositoryCache();

/** 缓存键与失效标签的统一构造，避免字符串散落各处。 */
export const authCacheKey = {
	verificationToken: (tokenHash: string): string => `verification_token:${tokenHash}`,
	deprecatedToken: (tokenHash: string): string => `deprecated_token:${tokenHash}`,
	team: (teamId: string): string => `team:${teamId}`,
	user: (userId: string): string => `user:${userId}`,
	organization: (organizationId: string): string => `organization:${organizationId}`,
	endUser: (endUserId: string): string => `end_user:${endUserId}`,
	budget: (budgetId: string): string => `budget:${budgetId}`,
	teamMembership: (userId: string, teamId: string): string => `team_membership:${userId}:${teamId}`,
	project: (projectId: string): string => `project:${projectId}`,
};

/** 主体标签：用于按用户/团队批量失效。 */
export const authCacheTag = {
	user: (userId: string): string => `user:${userId}`,
	team: (teamId: string): string => `team:${teamId}`,
};

/** 一次记账提交涉及的全部鉴权主体。 */
export interface AuthCacheSpendSubjects {
	/** 已保护的 key（与 VerificationToken.token 同值）。 */
	readonly tokenHash?: string | null;
	/** 记账请求所属用户。 */
	readonly userId?: string | null;
	/** 记账请求所属团队。 */
	readonly teamId?: string | null;
	/** 记账请求所属组织。 */
	readonly organizationId?: string | null;
	/** 记账请求所属项目。 */
	readonly projectId?: string | null;
	/** 记账请求的终端用户。 */
	readonly endUserId?: string | null;
}

/**
 * 记账提交后按主体失效缓存，使下一次鉴权读到最新 spend。
 * @param subjects - 本次落账影响到的 token/用户/团队等主体
 */
export function invalidateAuthCacheForSpendSubjects(subjects: AuthCacheSpendSubjects): void {
	if (subjects.tokenHash) {
		authRepositoryCache.delete(authCacheKey.verificationToken(subjects.tokenHash));
	}
	if (subjects.userId) {
		authRepositoryCache.delete(authCacheKey.user(subjects.userId));
		authRepositoryCache.deleteByTag(authCacheTag.user(subjects.userId));
	}
	if (subjects.teamId) {
		authRepositoryCache.delete(authCacheKey.team(subjects.teamId));
		authRepositoryCache.deleteByTag(authCacheTag.team(subjects.teamId));
	}
	if (subjects.userId && subjects.teamId) {
		authRepositoryCache.delete(authCacheKey.teamMembership(subjects.userId, subjects.teamId));
	}
	if (subjects.organizationId) {
		authRepositoryCache.delete(authCacheKey.organization(subjects.organizationId));
	}
	if (subjects.projectId) {
		authRepositoryCache.delete(authCacheKey.project(subjects.projectId));
	}
	if (subjects.endUserId) {
		authRepositoryCache.delete(authCacheKey.endUser(subjects.endUserId));
	}
}

/**
 * 抹掉某个 token 的缓存（封禁/删除/更新后调用）。
 * @param tokenHash - 已保护的 key
 */
export function invalidateAuthCacheForTokenHash(tokenHash: string): void {
	authRepositoryCache.delete(authCacheKey.verificationToken(tokenHash));
}

/**
 * 抹掉某个用户或团队名下的全部鉴权缓存（批量删 key/删号后调用）。
 * @param subject - 用户或团队
 */
export function invalidateAuthCacheForSubject(subject: { userId?: string | null; teamId?: string | null }): void {
	if (subject.userId) {
		authRepositoryCache.delete(authCacheKey.user(subject.userId));
		authRepositoryCache.deleteByTag(authCacheTag.user(subject.userId));
	}
	if (subject.teamId) {
		authRepositoryCache.delete(authCacheKey.team(subject.teamId));
		authRepositoryCache.deleteByTag(authCacheTag.team(subject.teamId));
	}
}

/** 启动/测试时记录一次缓存配置，便于运维确认是否生效。 */
export function logAuthCacheConfiguration(): void {
	logger.info("鉴权仓储缓存配置", {
		enabled: authRepositoryCache.enabled,
		ttlMs: resolveAuthRepositoryCacheTtlMs(process.env[AUTH_REPOSITORY_CACHE_TTL_ENV]),
	});
}
