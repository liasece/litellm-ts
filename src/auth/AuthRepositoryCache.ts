/**
 * 鉴权仓储读缓存。
 *
 * 鉴权链每请求要串行读若干次同一批实体（token、team、user、membership、budget…），
 * 这些行在一次请求里只读、且绝大多数在分钟级窗口内不会变。缓存放在仓储层而不是
 * 中间件层，好处是：所有读路径（HTTP 鉴权、AuthorizationGuard、WebUI 会话校验）
 * 自动共享同一份快照，写法与未缓存时完全一致。
 *
 * 失效模型（对应「没有延迟生效的缺点」）：
 * - 仓储自身的写方法（注销、续期、改配额）在写入后立刻写穿或删掉对应 key；
 * - 记账提交后按主体失效（token/user/team/membership/org/project/end-user），
 *   预算检查读到的是上一次提交后的 spend，而不是缓存里更早的旧值；
 * - 管理端点改/删 key 时按 tag 失效，删号/封号立即生效，不依赖 TTL 过期；
 * - TTL 只兜底「本进程之外」的变更（运维直接改库、另一套实例）。
 *
 * 服务是单实例部署、配置与账号变更都会经过本进程，因此这里的 TTL 放在分钟级：
 * 应用内写入靠写穿与标签失效保证立刻可见，分钟级窗口只用于兜住旁路写入。
 *
 * 负结果（不存在）不缓存：遍历式无效 token 探测不应该把缓存撑大，也不应该让刚
 * 创建的 key 在 TTL 内不可用。
 *
 * 读路径用 `load()` 而不是「先 get 再 set」：命中但剩余 TTL 不足阈值时，仍然立刻返回
 * 手里的旧值，同时在后台补一次读取（提前刷新）。高频请求的到达间隔常常刚好跨过 TTL，
 * 没有提前刷新时每一波第一个请求都要同步等一次库；提前刷新把这次等待从请求路径挪走，
 * 只留下「缓存里根本没有这条」的冷启动仍走同步读取。
 */

import { createModuleLogger } from "../core/utils/logger";
import { DEFAULT_ENTRY_CACHE_MAX_CONCURRENT_REFRESHES, EntryCache } from "../repositories/internal/EntryCache";

const logger = createModuleLogger("AuthRepositoryCache");

/**
 * 默认 TTL。
 *
 * 单实例部署下应用内的写都会经过仓储层并写穿/失效，TTL 只是旁路写入的兜底窗口，
 * 因此取 5 分钟：既能把鉴权链的库往返压到每个实体每 5 分钟一次，又不会让运维直接
 * 改库的变更藏太久。
 */
export const DEFAULT_AUTH_REPOSITORY_CACHE_TTL_MS = 300_000;

/** 单进程缓存条目上限，避免无效 token 探测把内存顶起来。 */
export const DEFAULT_AUTH_REPOSITORY_CACHE_MAX_ENTRIES = 4096;

/** 运维可在不重建镜像的情况下关闭/调整缓存。 */
export const AUTH_REPOSITORY_CACHE_TTL_ENV = "LITELLM_AUTH_REPOSITORY_CACHE_TTL_MS";

/** 提前刷新阈值：剩余 TTL 低于该值时异步补读，0 表示关闭提前刷新。 */
export const AUTH_REPOSITORY_CACHE_REFRESH_AHEAD_ENV = "LITELLM_AUTH_REPOSITORY_CACHE_REFRESH_AHEAD_MS";

/** 默认提前刷新阈值下限：TTL 很短时也要留出足够窗口，避免每次命中都触发刷新。 */
export const DEFAULT_AUTH_REPOSITORY_CACHE_REFRESH_AHEAD_MIN_MS = 250;

/** 默认提前刷新阈值占 TTL 的比例；5 分钟 TTL 即最后 75 秒内的命中会触发补读。 */
export const DEFAULT_AUTH_REPOSITORY_CACHE_REFRESH_AHEAD_RATIO = 0.25;

/** 单进程同时进行的后台补读上限，避免热点集中过期时把连接池打满。 */
export const DEFAULT_AUTH_REPOSITORY_CACHE_MAX_CONCURRENT_REFRESHES = DEFAULT_ENTRY_CACHE_MAX_CONCURRENT_REFRESHES;

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

/**
 * 解析提前刷新阈值：默认取 TTL 的四分之一（不少于 250 毫秒），0 表示关闭。
 * @param raw - 环境变量原文
 * @param ttlMs - 生效的缓存 TTL
 */
export function resolveAuthRepositoryRefreshAheadMs(raw: string | undefined, ttlMs: number): number {
	if (ttlMs <= 0) {
		return 0;
	}
	if (raw === undefined || raw.trim() === "") {
		return Math.max(
			DEFAULT_AUTH_REPOSITORY_CACHE_REFRESH_AHEAD_MIN_MS,
			Math.round(ttlMs * DEFAULT_AUTH_REPOSITORY_CACHE_REFRESH_AHEAD_RATIO),
		);
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) {
		return Math.max(
			DEFAULT_AUTH_REPOSITORY_CACHE_REFRESH_AHEAD_MIN_MS,
			Math.round(ttlMs * DEFAULT_AUTH_REPOSITORY_CACHE_REFRESH_AHEAD_RATIO),
		);
	}
	// 阈值不小于 TTL 时每一命中都会补读，等价于关掉提前刷新，因此夹到 TTL 以内。
	return Math.min(Math.round(parsed), ttlMs);
}

/** 鉴权实体的按键缓存；语义与实现见 `EntryCache`。 */
export class AuthRepositoryCache extends EntryCache<unknown> {
	/**
	 * @param options - 覆盖项；缺省取环境变量与内置默认值
	 */
	constructor(
		options: { ttlMs?: number; maxEntries?: number; now?: () => number; refreshAheadMs?: number; maxConcurrentRefreshes?: number } = {},
	) {
		const ttlMs = options.ttlMs ?? resolveAuthRepositoryCacheTtlMs(process.env[AUTH_REPOSITORY_CACHE_TTL_ENV]);
		super({
			ttlMs: ttlMs,
			refreshAheadMs:
				options.refreshAheadMs ?? resolveAuthRepositoryRefreshAheadMs(process.env[AUTH_REPOSITORY_CACHE_REFRESH_AHEAD_ENV], ttlMs),
			maxEntries: options.maxEntries ?? DEFAULT_AUTH_REPOSITORY_CACHE_MAX_ENTRIES,
			maxConcurrentRefreshes: options.maxConcurrentRefreshes ?? DEFAULT_AUTH_REPOSITORY_CACHE_MAX_CONCURRENT_REFRESHES,
			now: options.now,
			label: "auth",
		});
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
	// 对象权限不参与预算结算，但由管理端点按 id 读取；与其它租户实体共用同一个缓存实例，
	// 避免同一行在进程里存在两份副本。
	objectPermission: (objectPermissionId: string): string => `object_permission:${objectPermissionId}`,
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
	const ttlMs = resolveAuthRepositoryCacheTtlMs(process.env[AUTH_REPOSITORY_CACHE_TTL_ENV]);
	logger.info("鉴权仓储缓存配置", {
		enabled: authRepositoryCache.enabled,
		ttlMs: ttlMs,
		refreshAheadMs: resolveAuthRepositoryRefreshAheadMs(process.env[AUTH_REPOSITORY_CACHE_REFRESH_AHEAD_ENV], ttlMs),
	});
}
