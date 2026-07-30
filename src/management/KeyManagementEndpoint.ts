/**
 * 密钥管理端点 — CRUD + 生命周期操作
 *
 * 工厂函数：createKeyManagementRoutes(router, db, authMiddleware)
 * 注册所有 /key/* 路由，包括生成、更新、删除、阻止、轮换等操作。
 * 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/proxy_server.py
 */

import type { Router, Request } from "express";
import { and, eq, ilike, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { hashApiKey, generateApiKey } from "../core/utils/crypto";
import { LiteLLM_VerificationToken } from "../db/schema/verification-tokens";
import { liteLLM_DeprecatedVerificationToken } from "../db/schema/deprecated-tokens";
import { liteLLM_DeletedVerificationToken } from "../db/schema/deleted-verification-tokens";
import { LiteLLM_BudgetTable } from "../db/schema/budgets";
import type { AuthorizationGuard } from "../auth/AuthorizationGuard";
import { createModuleLogger } from "../core/utils/logger";
import { parsePositiveInt } from "../core/api/queryParams";
import { buildGenerateKeyResponse, toPythonKeyManagementRow } from "./pythonRowSerializers";
import { PROXY_ADMIN_USER_ID, WEBUI_LOGIN_TEAM_ID } from "../types/webUiSession";

const logger = createModuleLogger("Management:Key");

/** 日志中 token/hash 只展示固定长度前缀，避免泄露完整密钥材料。 */
const TOKEN_LOG_PREFIX_LENGTH = 8;

/** /key/list 分页常量（消除散落魔法数字） */
const KEY_LIST_PAGINATION = {
	defaultPage: 1,
	defaultPageSize: 10,
	maxPageSize: 100,
	minPage: 1,
	minPageSize: 1,
	minTotalPages: 1,
} as const;

/** /key/aliases 分页常量（对齐 Python LiteLLM Key Alias 下拉接口） */
const KEY_ALIAS_PAGINATION = {
	defaultPage: 1,
	defaultPageSize: 50,
	maxPageSize: 100,
	minPageSize: 1,
} as const;

/**
 * VerificationToken 单行投影。
 * Drizzle 行对象是 TypeScript camelCase 字段；Python LiteLLM / WebUI 契约是 Prisma 字段名（snake_case）。
 */
type VerificationTokenRowLike = { token: string } & Record<string, unknown>;

const VERIFICATION_TOKEN_FIELD_ALIASES: Readonly<Record<string, string>> = {
	keyName: "key_name",
	keyAlias: "key_alias",
	softBudgetCooldown: "soft_budget_cooldown",
	routerSettings: "router_settings",
	userId: "user_id",
	teamId: "team_id",
	agentId: "agent_id",
	projectId: "project_id",
	maxParallelRequests: "max_parallel_requests",
	tpmLimit: "tpm_limit",
	rpmLimit: "rpm_limit",
	maxBudget: "max_budget",
	budgetDuration: "budget_duration",
	budgetResetAt: "budget_reset_at",
	allowedCacheControls: "allowed_cache_controls",
	allowedRoutes: "allowed_routes",
	accessGroupIds: "access_group_ids",
	modelSpend: "model_spend",
	modelMaxBudget: "model_max_budget",
	budgetId: "budget_id",
	organizationId: "organization_id",
	objectPermissionId: "object_permission_id",
	createdAt: "created_at",
	createdBy: "created_by",
	updatedAt: "updated_at",
	updatedBy: "updated_by",
	lastActive: "last_active",
	rotationCount: "rotation_count",
	autoRotate: "auto_rotate",
	rotationInterval: "rotation_interval",
	lastRotationAt: "last_rotation_at",
	keyRotationAt: "key_rotation_at",
	deletedAt: "deleted_at",
	deletedBy: "deleted_by",
	deletedByApiKey: "deleted_by_api_key",
	litellmChangedBy: "litellm_changed_by",
};

/**
 * 转成 Python LiteLLM UserAPIKeyAuth / VerificationToken 响应字段名。
 * @param row - 原始 DB 行
 * @param includeToken - Python `return_full_object=true` 会返回 token 字段，WebUI 用它做 Key ID 与后续管理操作
 */
function toPythonVerificationTokenRow(row: VerificationTokenRowLike, includeToken: boolean): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(row)) {
		if (key === "token" && !includeToken) {
			continue;
		}
		output[VERIFICATION_TOKEN_FIELD_ALIASES[key] ?? key] = value;
	}
	if (output["organization_id"] !== undefined && output["org_id"] === undefined) {
		// 当前复制版 WebUI 的 VirtualKeysTable 读取 org_id；Python 返回链路中也存在该兼容别名。
		output["org_id"] = output["organization_id"];
	}
	return output;
}

/**
 * 明文 API key 的前缀：用于判断"是否需要先 hash 再查 DB"。
 * 与 core/utils/crypto.generateApiKey 保持单一事实来源。
 */
const PLAIN_API_KEY_PREFIX = "sk-";

/** Python LiteLLM UpdateRouterConfig 缺省展开与 GenerateKeyResponse 构造统一由 pythonRowSerializers 提供。 */

const DURATION_UNIT_SECONDS: Readonly<Record<string, number>> = {
	s: 1,
	m: 60,
	h: 3600,
	d: 86400,
	w: 604800,
};

/**
 * 解析 Python duration 字符串（"30d"/"1h"/"15m"/"10s"/"2w"）为 expires 时刻。
 * 对齐 litellm/litellm_core_utils/duration_parser.py；非法格式抛 400。
 * @param duration - 请求体 duration 字段
 * @param now - 生成基准时间
 * @throws 当 duration 格式非法时抛 400 `ApiError`
 */
export function resolveExpiresFromDuration(duration: string, now: Date): Date {
	const match = /^(\d+)(mo|s|m|h|d|w)$/.exec(duration.trim());
	if (!match) {
		throw ApiError.badRequest(`Invalid duration format: ${duration}`);
	}
	const value = Number(match[1]);
	const unit = match[2]!;
	if (unit === "mo") {
		// 日历月加算（对齐 Python duration_in_seconds 的 mo 分支）
		const expires = new Date(now.getTime());
		expires.setMonth(expires.getMonth() + value);
		return expires;
	}
	return new Date(now.getTime() + value * DURATION_UNIT_SECONDS[unit]! * 1000);
}

/**
 * 把 KeyRequest 字符串归一化为 DB 存储的 token。
 *   - 明文 `sk-*` → hashApiKey(token)
 *   - 已 hashed token → 原样
 * @param token
 */
function hashTokenIfNeeded(token: string): string {
	return token.startsWith(PLAIN_API_KEY_PREFIX) ? hashApiKey(token) : token;
}

interface KeyInfoLookup {
	readonly requestKey: string;
	readonly tokenId: string;
}

function firstString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function resolveAuthToken(req: Request): string | undefined {
	const token = firstString(req.auth?.token);
	if (token) {
		return token;
	}
	const apiKey = firstString(req.auth?.api_key);
	return apiKey ? hashTokenIfNeeded(apiKey) : undefined;
}

function resolveKeyInfoLookup(req: Request, source: "query" | "body"): KeyInfoLookup {
	const record = source === "query" ? req.query : (req.body ?? {});
	const provided = firstString((record as Record<string, unknown>).key) ?? firstString((record as Record<string, unknown>).token);
	const resolved = provided ?? resolveAuthToken(req);
	if (!resolved) {
		throw ApiError.badRequest("key or token is required");
	}
	const tokenId = hashTokenIfNeeded(resolved);
	return {
		requestKey: provided ? resolved : tokenId,
		tokenId: tokenId,
	};
}

function isExpiredValue(value: unknown): boolean {
	if (!value) {
		return false;
	}
	const expires = value instanceof Date ? value : new Date(String(value));
	return Number.isFinite(expires.getTime()) && expires.getTime() < Date.now();
}

function matchesKeyListFilters(row: VerificationTokenRowLike, filters: KeyListFilters): boolean {
	if (filters.userId !== undefined && row.userId !== filters.userId) {
		return false;
	}
	if (filters.teamId !== undefined && row.teamId !== filters.teamId) {
		return false;
	}
	if (filters.organizationId !== undefined && row.organizationId !== filters.organizationId) {
		return false;
	}
	if (filters.keyHash !== undefined && row.token !== filters.keyHash) {
		return false;
	}
	if (filters.keyAlias !== undefined && row.keyAlias !== filters.keyAlias) {
		return false;
	}
	if (filters.projectId !== undefined && row.projectId !== filters.projectId) {
		return false;
	}
	if (filters.accessGroupId !== undefined) {
		const accessGroupIds = row.accessGroupIds;
		if (!Array.isArray(accessGroupIds) || !accessGroupIds.includes(filters.accessGroupId)) {
			return false;
		}
	}
	if (filters.status === "blocked" && row.blocked !== true) {
		return false;
	}
	if (filters.status === "active" && (row.blocked === true || isExpiredValue(row.expires))) {
		return false;
	}
	if (filters.status === "expired" && !isExpiredValue(row.expires)) {
		return false;
	}
	return true;
}

interface KeyListFilters {
	readonly userId?: string;
	readonly teamId?: string;
	readonly organizationId?: string;
	readonly keyHash?: string;
	readonly keyAlias?: string;
	readonly projectId?: string;
	readonly accessGroupId?: string;
	readonly status?: "active" | "blocked" | "expired" | "deleted";
}

function parseKeyListFilters(query: Request["query"]): KeyListFilters {
	const keyHash = firstString(query.key_hash);
	const status = firstString(query.status);
	return {
		userId: firstString(query.user_id),
		teamId: firstString(query.team_id),
		organizationId: firstString(query.organization_id),
		keyHash: keyHash ? hashTokenIfNeeded(keyHash) : undefined,
		keyAlias: firstString(query.key_alias),
		projectId: firstString(query.project_id),
		accessGroupId: firstString(query.access_group_id),
		status: status === "active" || status === "blocked" || status === "expired" || status === "deleted" ? status : undefined,
	};
}

function buildKeyListWhere(filters: KeyListFilters): ReturnType<typeof and> {
	const conditions = [or(isNull(LiteLLM_VerificationToken.teamId), ne(LiteLLM_VerificationToken.teamId, WEBUI_LOGIN_TEAM_ID))];
	if (filters.userId !== undefined) {
		conditions.push(eq(LiteLLM_VerificationToken.userId, filters.userId));
	}
	if (filters.teamId !== undefined) {
		conditions.push(eq(LiteLLM_VerificationToken.teamId, filters.teamId));
	}
	if (filters.organizationId !== undefined) {
		conditions.push(eq(LiteLLM_VerificationToken.organizationId, filters.organizationId));
	}
	if (filters.keyHash !== undefined) {
		conditions.push(eq(LiteLLM_VerificationToken.token, filters.keyHash));
	}
	if (filters.keyAlias !== undefined) {
		conditions.push(eq(LiteLLM_VerificationToken.keyAlias, filters.keyAlias));
	}
	if (filters.projectId !== undefined) {
		conditions.push(eq(LiteLLM_VerificationToken.projectId, filters.projectId));
	}
	if (filters.status === "blocked") {
		conditions.push(eq(LiteLLM_VerificationToken.blocked, true));
	}
	if (filters.status === "active") {
		conditions.push(or(isNull(LiteLLM_VerificationToken.blocked), eq(LiteLLM_VerificationToken.blocked, false)));
	}
	return and(...conditions);
}

function buildDeletedKeyListWhere(filters: KeyListFilters): ReturnType<typeof and> {
	const conditions = [
		or(isNull(liteLLM_DeletedVerificationToken.teamId), ne(liteLLM_DeletedVerificationToken.teamId, WEBUI_LOGIN_TEAM_ID)),
	];
	if (filters.userId !== undefined) {
		conditions.push(eq(liteLLM_DeletedVerificationToken.userId, filters.userId));
	}
	if (filters.teamId !== undefined) {
		conditions.push(eq(liteLLM_DeletedVerificationToken.teamId, filters.teamId));
	}
	if (filters.organizationId !== undefined) {
		conditions.push(eq(liteLLM_DeletedVerificationToken.organizationId, filters.organizationId));
	}
	if (filters.keyHash !== undefined) {
		conditions.push(eq(liteLLM_DeletedVerificationToken.token, filters.keyHash));
	}
	if (filters.keyAlias !== undefined) {
		conditions.push(eq(liteLLM_DeletedVerificationToken.keyAlias, filters.keyAlias));
	}
	if (filters.projectId !== undefined) {
		conditions.push(eq(liteLLM_DeletedVerificationToken.projectId, filters.projectId));
	}
	return and(...conditions);
}

interface KeyAliasFilters {
	readonly search?: string;
	readonly teamId?: string;
}

function buildKeyAliasesWhere(filters: KeyAliasFilters): ReturnType<typeof and> {
	const conditions = [
		isNotNull(LiteLLM_VerificationToken.keyAlias),
		ne(LiteLLM_VerificationToken.keyAlias, ""),
		or(isNull(LiteLLM_VerificationToken.teamId), ne(LiteLLM_VerificationToken.teamId, WEBUI_LOGIN_TEAM_ID)),
	];
	if (filters.search !== undefined) {
		conditions.push(ilike(LiteLLM_VerificationToken.keyAlias, `%${filters.search}%`));
	}
	if (filters.teamId !== undefined) {
		conditions.push(eq(LiteLLM_VerificationToken.teamId, filters.teamId));
	}
	return and(...conditions);
}

function sortKeyListRows(
	rows: VerificationTokenRowLike[],
	sortBy: string | undefined,
	sortOrder: string | undefined,
): VerificationTokenRowLike[] {
	const sortFieldMap: Readonly<Record<string, keyof VerificationTokenRowLike>> = {
		created_at: "createdAt",
		updated_at: "updatedAt",
		last_active: "lastActive",
		key_alias: "keyAlias",
		key_name: "keyName",
		user_id: "userId",
		team_id: "teamId",
		organization_id: "organizationId",
		spend: "spend",
	};
	const field = sortFieldMap[sortBy ?? ""];
	if (!field) {
		return rows;
	}
	const direction = sortOrder === "desc" ? -1 : 1;
	return [...rows].sort((a, b) => {
		const left = a[field];
		const right = b[field];
		if (left === right) {
			return 0;
		}
		if (left === null || left === undefined) {
			return 1;
		}
		if (right === null || right === undefined) {
			return -1;
		}
		const leftComparable = left instanceof Date ? left.getTime() : String(left);
		const rightComparable = right instanceof Date ? right.getTime() : String(right);
		return leftComparable < rightComparable ? -1 * direction : direction;
	});
}

/**
 * 校验请求体字段是"非空 string 数组"，否则抛 400 阻止静默部分删除。
 * @param value - 请求体字段值
 * @param fieldName - 字段名（用于错误信息）
 * @returns 过滤掉空字符串后的 string[]
 * @throws 当 value 不是数组时抛 400 `ApiError`
 */
function parseNonEmptyStringArray(value: unknown, fieldName: "keys" | "key_aliases"): string[] {
	if (!Array.isArray(value)) {
		throw ApiError.badRequest(`'${fieldName}' must be a string array`);
	}
	const filtered = value.filter((item): item is string => typeof item === "string" && item.length > 0);
	return filtered;
}

/**
 * 解析 KeyRequest：keys 与 key_aliases 至少一个非空；keys 非空时优先。
 * 返回判别式联合，确保路由处理器按 kind 分支后字段必现。
 */
type ParsedKeyDeleteRequest =
	| { readonly kind: "keys"; readonly requestedValues: string[]; readonly tokens: string[] }
	| { readonly kind: "key_aliases"; readonly requestedValues: string[]; readonly keyAliases: string[] };

function parseKeyDeleteRequest(body: unknown): ParsedKeyDeleteRequest {
	const record = (body ?? {}) as { keys?: unknown; key_aliases?: unknown };

	// 仅在字段"实际存在"时才校验元素类型：字段缺失（undefined）应走"两者皆无"的统一 400 路径，
	// 而不是先抛 "'keys' must be a string array"，让上层错误信息对用户更清晰。
	if (record.keys !== undefined) {
		const keys = parseNonEmptyStringArray(record.keys, "keys");
		if (keys.length > 0) {
			// WebUI/Python 都会传 hashed token；只有"看起来像明文"的才走 hash 分支。
			// tokens 字段给 DB 查询用，requestedValues 给响应回显用——保留原值不丢失明文。
			return { kind: "keys", requestedValues: keys, tokens: keys };
		}
	}

	if (record.key_aliases !== undefined) {
		const aliases = parseNonEmptyStringArray(record.key_aliases, "key_aliases");
		if (aliases.length > 0) {
			return { kind: "key_aliases", requestedValues: aliases, keyAliases: aliases };
		}
	}

	throw ApiError.badRequest("At least one of 'keys' or 'key_aliases' must be provided.");
}

/**
 * 解析请求或环境变量中的 key rotation grace period；空值表示立即撤销旧 key。
 * @param body
 * @param now
 */
function resolveRotationRevokeAt(body: Record<string, unknown>, now: Date): Date | null {
	const gracePeriod = firstString(body.grace_period) ?? firstString(process.env.LITELLM_KEY_ROTATION_GRACE_PERIOD);
	return gracePeriod ? resolveExpiresFromDuration(gracePeriod, now) : null;
}

/**
 * 创建密钥管理路由
 * @param router - Express Router 实例
 * @param db - Drizzle 数据库实例
 * @param authorizationGuard - 集中对象授权边界；测试可传 null
 */
export function createKeyManagementRoutes(router: Router, db: DrizzleDb, authorizationGuard: AuthorizationGuard | null): void {
	function authed(handler: (req: Request) => unknown | Promise<unknown>): (req: Request) => unknown | Promise<unknown> {
		return handler;
	}

	// ─── POST /key/generate ────────────────────────────────────
	// 响应对齐 Python GenerateKeyResponse 完整字段集（50+ 字段），
	// 字段命名/缺省值以 Python 版实测为准。协议源码：litellm/proxy/_types.py。
	registerRoute(
		router,
		{ method: "post", path: "/key/generate" },
		authed(async (req) => {
			const body = (req.body ?? {}) as Record<string, unknown>;
			await authorizationGuard?.assertCanCreateKey(req.auth, firstString(body.team_id));
			const now = new Date();

			// Python: duration 优先于 expires，expires = now + duration
			const expiresValue =
				typeof body.duration === "string" && body.duration.length > 0
					? resolveExpiresFromDuration(body.duration, now)
					: body.expires
						? new Date(body.expires as string)
						: null;

			// 生成 API 密钥并哈希
			const plainKey = generateApiKey();
			const tokenHash = hashApiKey(plainKey);
			// Python: key_name 缺省时自动置为 "sk-..." + 明文后 4 位
			const keyName = typeof body.key_name === "string" && body.key_name.length > 0 ? body.key_name : `sk-...${plainKey.slice(-4)}`;
			const createdBy = req.auth?.user_id ?? PROXY_ADMIN_USER_ID;

			// 检查哈希是否已存在（极小概率碰撞）
			const existing = await db
				.select()
				.from(LiteLLM_VerificationToken)
				.where(eq(LiteLLM_VerificationToken.token, tokenHash))
				.limit(1);
			if (existing.length > 0) {
				throw ApiError.conflict("Key hash collision, please retry");
			}

			// Python: budget_id 存在时 litellm_budget_table 返回关联预算行
			const budgetId = typeof body.budget_id === "string" && body.budget_id.length > 0 ? body.budget_id : null;
			let budgetRow: Record<string, unknown> | null = null;
			if (budgetId !== null) {
				const budgetRows = await db.select().from(LiteLLM_BudgetTable).where(eq(LiteLLM_BudgetTable.budget_id, budgetId)).limit(1);
				budgetRow = (budgetRows[0] as Record<string, unknown> | undefined) ?? null;
			}

			await db.insert(LiteLLM_VerificationToken).values({
				token: tokenHash,
				keyAlias: (body.key_alias as string | undefined) ?? null,
				keyName: keyName,
				userId: (body.user_id as string | undefined) ?? null,
				teamId: (body.team_id as string | undefined) ?? null,
				agentId: (body.agent_id as string | undefined) ?? null,
				projectId: (body.project_id as string | undefined) ?? null,
				organizationId: (body.organization_id as string | undefined) ?? null,
				budgetId: budgetId,
				metadata: (body.metadata as Record<string, unknown> | undefined) ?? {},
				models: (body.models as string[] | undefined) ?? [],
				maxBudget: (body.max_budget as number | undefined) ?? null,
				maxParallelRequests: (body.max_parallel_requests as number | undefined) ?? null,
				tpmLimit: (body.tpm_limit as number | undefined) ?? null,
				rpmLimit: (body.rpm_limit as number | undefined) ?? null,
				budgetDuration: (body.budget_duration as string | undefined) ?? null,
				allowedCacheControls: (body.allowed_cache_controls as string[] | undefined) ?? [],
				config: (body.config as Record<string, unknown> | undefined) ?? {},
				permissions: (body.permissions as Record<string, unknown> | undefined) ?? {},
				modelMaxBudget: (body.model_max_budget as Record<string, unknown> | undefined) ?? {},
				aliases: (body.aliases as Record<string, unknown> | undefined) ?? {},
				routerSettings: (body.router_settings as Record<string, unknown> | undefined) ?? {},
				policies: (body.policies as string[] | undefined) ?? null,
				accessGroupIds: (body.access_group_ids as string[] | undefined) ?? [],
				expires: expiresValue,
				allowedRoutes: (body.allowed_routes as string[] | undefined) ?? [],
				blocked: (body.blocked as boolean | undefined) ?? false,
				createdBy: createdBy,
				updatedBy: createdBy,
				createdAt: now,
				updatedAt: now,
			});

			logger.info(`Key generated: ${(body.key_alias as string | undefined) ?? "unnamed"}`);

			return buildGenerateKeyResponse({
				body: body,
				plainKey: plainKey,
				tokenHash: tokenHash,
				keyName: keyName,
				expires: expiresValue,
				createdBy: createdBy,
				now: now,
				budgetRow: budgetRow,
			});
		}),
	);

	// ─── POST /key/update ──────────────────────────────────────
	// 响应对齐 Python update_key_fn 实测：{ key: 原请求 key, ...更新后完整 key 对象（48 键） }。
	// 协议源码：litellm/proxy/management_endpoints/key_management_endpoints.py update_key_fn
	registerRoute(
		router,
		{ method: "post", path: "/key/update" },
		authed(async (req) => {
			const { key, token, ...updates } = req.body ?? {};
			const tokenId = token ?? (key ? hashApiKey(key) : null);

			if (!tokenId) {
				throw ApiError.badRequest("key or token is required");
			}

			const existing = await db.select().from(LiteLLM_VerificationToken).where(eq(LiteLLM_VerificationToken.token, tokenId)).limit(1);
			if (existing.length === 0) {
				throw ApiError.notFound("Key not found");
			}
			await authorizationGuard?.assertKeyAccess(req.auth, existing, "write");

			// 构建可更新字段
			const updateFields: Record<string, unknown> = {};
			if (updates.key_alias !== undefined) {
				updateFields.keyAlias = updates.key_alias;
			}
			if (updates.key_name !== undefined) {
				updateFields.keyName = updates.key_name;
			}
			if (updates.user_id !== undefined) {
				updateFields.userId = updates.user_id;
			}
			if (updates.team_id !== undefined) {
				updateFields.teamId = updates.team_id;
			}
			if (updates.metadata !== undefined) {
				updateFields.metadata = updates.metadata;
			}
			if (updates.models !== undefined) {
				updateFields.models = updates.models;
			}
			if (updates.max_budget !== undefined) {
				updateFields.maxBudget = updates.max_budget;
			}
			if (updates.tpm_limit !== undefined) {
				updateFields.tpmLimit = updates.tpm_limit;
			}
			if (updates.rpm_limit !== undefined) {
				updateFields.rpmLimit = updates.rpm_limit;
			}
			if (updates.expires !== undefined) {
				updateFields.expires = updates.expires ? new Date(updates.expires) : null;
			}
			if (updates.permissions !== undefined) {
				updateFields.permissions = updates.permissions;
			}
			if (updates.allowed_routes !== undefined) {
				updateFields.allowedRoutes = updates.allowed_routes;
			}
			if (updates.budget_id !== undefined) {
				updateFields.budgetId = updates.budget_id;
			}

			await db
				.update(LiteLLM_VerificationToken)
				.set({ ...updateFields, updatedAt: new Date() })
				.where(eq(LiteLLM_VerificationToken.token, tokenId));

			logger.info(`Key updated: ${tokenId.slice(0, TOKEN_LOG_PREFIX_LENGTH)}...`);

			// 重查更新后完整行，序列化为 Python 48 键 key 对象
			const updatedRows = await db
				.select()
				.from(LiteLLM_VerificationToken)
				.where(eq(LiteLLM_VerificationToken.token, tokenId))
				.limit(1);
			const updatedRow = updatedRows[0]!;

			// Python: budget_id 非空时 litellm_budget_table 返回关联预算行
			let budgetRow: Record<string, unknown> | null = null;
			if (updatedRow.budgetId !== null) {
				const budgetRows = await db
					.select()
					.from(LiteLLM_BudgetTable)
					.where(eq(LiteLLM_BudgetTable.budget_id, updatedRow.budgetId))
					.limit(1);
				budgetRow = (budgetRows[0] as Record<string, unknown> | undefined) ?? null;
			}

			return {
				key: key ?? token,
				...toPythonKeyManagementRow(updatedRow, { includeToken: true, budgetRow: budgetRow }),
			};
		}),
	);

	// ─── POST /key/delete ──────────────────────────────────────
	// 对齐 Python LiteLLM `KeyRequest`：支持 keys（hashed 或明文 sk-*）与 key_aliases。
	//   - keys 优先；两者至少一个非空
	//   - 成功返回 { deleted_keys: 原请求数组 }
	// 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/_types.py (KeyRequest)
	// 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/key_management_endpoints.py (/key/delete)
	registerRoute(
		router,
		{ method: "post", path: "/key/delete" },
		authed(async (req) => {
			const parsed = parseKeyDeleteRequest(req.body ?? {});
			const deletedAt = new Date();
			await db.transaction(async (tx) => {
				const requestedTokens = parsed.kind === "keys" ? [...new Set(parsed.tokens.map(hashTokenIfNeeded))] : undefined;
				const requestedAliases = parsed.kind === "key_aliases" ? parsed.keyAliases : undefined;
				const matchedRows = await tx
					.select()
					.from(LiteLLM_VerificationToken)
					.where(
						requestedTokens
							? inArray(LiteLLM_VerificationToken.token, requestedTokens)
							: inArray(LiteLLM_VerificationToken.keyAlias, requestedAliases!),
					);

				const allTargetsExist = requestedTokens
					? matchedRows.length === requestedTokens.length
					: requestedAliases!.every((alias) => matchedRows.some((row) => row.keyAlias === alias));
				if (!allTargetsExist || matchedRows.length === 0) {
					throw ApiError.notFound("No keys found");
				}
				await authorizationGuard?.assertKeyAccess(req.auth, matchedRows, "write");

				await tx.insert(liteLLM_DeletedVerificationToken).values(
					matchedRows.map((row) => ({
						...row,
						deletedAt: deletedAt,
						deletedBy: req.auth?.user_id ?? null,
						deletedByApiKey: req.auth?.token ?? null,
						litellmChangedBy: firstString(req.header("litellm-changed-by")) ?? null,
					})),
				);
				await tx.delete(LiteLLM_VerificationToken).where(
					inArray(
						LiteLLM_VerificationToken.token,
						matchedRows.map((row) => row.token),
					),
				);
				logger.info(`Keys deleted: count=${matchedRows.length}`);
			});
			return { deleted_keys: parsed.requestedValues };
		}),
	);

	// ─── GET /key/info ─────────────────────────────────────────
	registerRoute(
		router,
		{ method: "get", path: "/key/info" },
		authed(async (req) => {
			const lookup = resolveKeyInfoLookup(req, "query");
			const rows = await db
				.select()
				.from(LiteLLM_VerificationToken)
				.where(eq(LiteLLM_VerificationToken.token, lookup.tokenId))
				.limit(1);
			if (rows.length === 0) {
				throw ApiError.notFound("Key not found");
			}
			await authorizationGuard?.assertKeyAccess(req.auth, rows, "read");
			return { key: lookup.requestKey, info: toPythonVerificationTokenRow(rows[0]!, false) };
		}),
	);

	// ─── POST /key/info ────────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/key/info" },
		authed(async (req) => {
			const lookup = resolveKeyInfoLookup(req, "body");
			const rows = await db
				.select()
				.from(LiteLLM_VerificationToken)
				.where(eq(LiteLLM_VerificationToken.token, lookup.tokenId))
				.limit(1);
			if (rows.length === 0) {
				throw ApiError.notFound("Key not found");
			}
			await authorizationGuard?.assertKeyAccess(req.auth, rows, "read");
			return { success: true, data: toPythonVerificationTokenRow(rows[0]!, false) };
		}),
	);

	// ─── POST /v2/key/info ─────────────────────────────────────
	// WebUI 调用（见 ui/litellm-dashboard/src/components/networking.tsx::keyInfoCall）：
	//   POST { keys: string[] } → 返回指定 key 列表的元信息。
	//
	// 对齐 Python LiteLLM `info_key_fn_v2` (key_management_endpoints.py L3210)：
	//   - 请求体为 KeyRequest（含 keys 与可选 key_aliases）。
	//   - 按 token 数组 inArray 过滤查询 — 避免无 keys 时全表返回。
	//   - 响应 shape：{ key: 原 keys 数组, info: 匹配行（去掉 token 字段） }。
	//   - 鉴权：依赖 user_api_key_auth；TS 端由主 router 统一 `authed` 包装。
	//
	// 注意：当前 TS 端未实现 key_aliases 解析（不支持别名查 token），仅按 keys 过滤。
	registerRoute(
		router,
		{ method: "post", path: "/v2/key/info" },
		authed(async (req) => {
			const body = (req.body ?? {}) as { keys?: unknown; key_aliases?: unknown };
			const rawKeys = Array.isArray(body.keys) ? body.keys : [];
			const requestedKeys = rawKeys.filter((k): k is string => typeof k === "string" && k.length > 0);
			const tokens = requestedKeys.map(hashTokenIfNeeded);

			if (tokens.length === 0) {
				return { key: rawKeys, info: [] };
			}

			const rows = await db.select().from(LiteLLM_VerificationToken).where(inArray(LiteLLM_VerificationToken.token, tokens));
			await authorizationGuard?.assertKeyAccess(req.auth, rows, "read");

			const info = rows.map((row) => toPythonVerificationTokenRow(row, false));

			return { key: rawKeys, info: info };
		}),
	);

	// ─── GET /key/aliases ─────────────────────────────────────
	// Logs 页 Key Alias 过滤器使用的分页数据源。对齐 Python LiteLLM：
	// - 排除空 alias 与 WebUI session key
	// - 非管理员只返回对象授权范围内的 key alias
	// - 支持大小写不敏感的部分搜索与 team_id 过滤
	// - 空结果 total_pages=0
	registerRoute(
		router,
		{ method: "get", path: "/key/aliases" },
		authed(async (req) => {
			const page = parsePositiveInt(req.query.page, KEY_ALIAS_PAGINATION.defaultPage);
			const pageSize = Math.min(
				KEY_ALIAS_PAGINATION.maxPageSize,
				Math.max(
					KEY_ALIAS_PAGINATION.minPageSize,
					parsePositiveInt(req.query.size, KEY_ALIAS_PAGINATION.defaultPageSize),
				),
			);
			const filters: KeyAliasFilters = {
				search: firstString(req.query.search),
				teamId: firstString(req.query.team_id),
			};
			const rows = await db.select().from(LiteLLM_VerificationToken).where(buildKeyAliasesWhere(filters));
			const visibleRows = authorizationGuard ? await authorizationGuard.filterVisibleKeys(req.auth, rows) : rows;
			const normalizedSearch = filters.search?.toLocaleLowerCase();
			const aliases = visibleRows
				.filter((row) => {
					const alias = row.keyAlias;
					if (typeof alias !== "string" || alias.length === 0 || row.teamId === WEBUI_LOGIN_TEAM_ID) {
						return false;
					}
					if (filters.teamId !== undefined && row.teamId !== filters.teamId) {
						return false;
					}
					return normalizedSearch === undefined || alias.toLocaleLowerCase().includes(normalizedSearch);
				})
				.map((row) => row.keyAlias as string)
				.sort((left, right) => left.localeCompare(right));
			const totalCount = aliases.length;
			const startIndex = (page - 1) * pageSize;

			return {
				aliases: aliases.slice(startIndex, startIndex + pageSize),
				total_count: totalCount,
				current_page: page,
				total_pages: totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize),
				size: pageSize,
			};
		}),
	);

	// ─── GET /key/list ─────────────────────────────────────────
	// WebUI 期望：{ keys, total_count, current_page, total_pages }
	// Python LiteLLM proxy_server.py::list_keys 行为一致
	registerRoute(
		router,
		{ method: "get", path: "/key/list" },
		authed(async (req) => {
			const page = parsePositiveInt(req.query.page, KEY_LIST_PAGINATION.defaultPage);
			const pageSize = Math.min(
				KEY_LIST_PAGINATION.maxPageSize,
				Math.max(KEY_LIST_PAGINATION.minPageSize, parsePositiveInt(req.query.size, KEY_LIST_PAGINATION.defaultPageSize)),
			);
			const filters = parseKeyListFilters(req.query);
			const rows: VerificationTokenRowLike[] =
				filters.status === "deleted"
					? await db.select().from(liteLLM_DeletedVerificationToken).where(buildDeletedKeyListWhere(filters))
					: await db.select().from(LiteLLM_VerificationToken).where(buildKeyListWhere(filters));
			const visibleRows = authorizationGuard ? await authorizationGuard.filterVisibleKeys(req.auth, rows) : rows;
			const filteredRows = visibleRows.filter((row) => matchesKeyListFilters(row, filters));
			const sortedRows = sortKeyListRows(filteredRows, firstString(req.query.sort_by), firstString(req.query.sort_order));
			const totalCount = sortedRows.length;
			const startIndex = (page - 1) * pageSize;
			const pageRows = sortedRows.slice(startIndex, startIndex + pageSize);
			const totalPages =
				pageSize > 0
					? Math.max(KEY_LIST_PAGINATION.minTotalPages, Math.ceil(totalCount / pageSize))
					: KEY_LIST_PAGINATION.minTotalPages;

			const returnFullObject = req.query.return_full_object === "true";
			const keys = returnFullObject
				? pageRows.map((row) => toPythonVerificationTokenRow(row, true))
				: pageRows.map((row) => row.token);

			return {
				keys: keys,
				total_count: totalCount,
				current_page: page,
				total_pages: totalPages,
			};
		}),
	);

	// ─── POST /key/block ───────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/key/block" },
		authed(async (req) => {
			const { key, token } = req.body ?? {};
			const tokenId = token ?? (key ? hashApiKey(key) : null);

			if (!tokenId) {
				throw ApiError.badRequest("key or token is required");
			}
			const targetRows = await db
				.select()
				.from(LiteLLM_VerificationToken)
				.where(eq(LiteLLM_VerificationToken.token, tokenId))
				.limit(1);
			if (targetRows.length === 0) {
				throw ApiError.notFound("Key not found");
			}
			await authorizationGuard?.assertKeyAccess(req.auth, targetRows, "write");

			const result = await db
				.update(LiteLLM_VerificationToken)
				.set({ blocked: true, updatedAt: new Date() })
				.where(eq(LiteLLM_VerificationToken.token, tokenId));

			if (result.rowCount === 0) {
				throw ApiError.notFound("Key not found");
			}

			logger.info(`Key blocked: ${tokenId.slice(0, TOKEN_LOG_PREFIX_LENGTH)}...`);

			return { success: true };
		}),
	);

	// ─── POST /key/unblock ─────────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/key/unblock" },
		authed(async (req) => {
			const { key, token } = req.body ?? {};
			const tokenId = token ?? (key ? hashApiKey(key) : null);

			if (!tokenId) {
				throw ApiError.badRequest("key or token is required");
			}
			const targetRows = await db
				.select()
				.from(LiteLLM_VerificationToken)
				.where(eq(LiteLLM_VerificationToken.token, tokenId))
				.limit(1);
			if (targetRows.length === 0) {
				throw ApiError.notFound("Key not found");
			}
			await authorizationGuard?.assertKeyAccess(req.auth, targetRows, "write");

			const result = await db
				.update(LiteLLM_VerificationToken)
				.set({ blocked: false, updatedAt: new Date() })
				.where(eq(LiteLLM_VerificationToken.token, tokenId));

			if (result.rowCount === 0) {
				throw ApiError.notFound("Key not found");
			}

			logger.info(`Key unblocked: ${tokenId.slice(0, TOKEN_LOG_PREFIX_LENGTH)}...`);

			return { success: true };
		}),
	);

	// ─── POST /key/regenerate ──────────────────────────────────
	registerRoute(
		router,
		{ method: "post", path: "/key/regenerate" },
		authed(async (req) => {
			const { key, token } = req.body ?? {};
			const oldTokenId = token ?? (key ? hashApiKey(key) : null);

			if (!oldTokenId) {
				throw ApiError.badRequest("key or token is required");
			}

			const body = (req.body ?? {}) as Record<string, unknown>;
			const now = new Date();
			const newPlainKey = firstString(body.new_key) ?? generateApiKey();
			const newTokenHash = hashApiKey(newPlainKey);
			const revokeAt = resolveRotationRevokeAt(body, now);

			await db.transaction(async (tx) => {
				const existing = await tx
					.select()
					.from(LiteLLM_VerificationToken)
					.where(eq(LiteLLM_VerificationToken.token, oldTokenId))
					.limit(1);
				if (existing.length === 0) {
					throw ApiError.notFound("Key not found");
				}
				await authorizationGuard?.assertKeyAccess(req.auth, existing, "write");

				const collision = await tx
					.select()
					.from(LiteLLM_VerificationToken)
					.where(eq(LiteLLM_VerificationToken.token, newTokenHash))
					.limit(1);
				if (collision.length > 0) {
					throw ApiError.conflict("New key hash collision, please retry");
				}

				if (revokeAt) {
					await tx.insert(liteLLM_DeprecatedVerificationToken).values({
						token: oldTokenId,
						activeTokenId: newTokenHash,
						revokeAt: revokeAt,
					});
				}
				const record = existing[0]!;
				await tx
					.update(LiteLLM_VerificationToken)
					.set({
						token: newTokenHash,
						keyName: `sk-...${newPlainKey.slice(-4)}`,
						rotationCount: (record.rotationCount ?? 0) + 1,
						lastRotationAt: now,
						updatedAt: now,
						updatedBy: req.auth?.user_id ?? record.updatedBy,
					})
					.where(eq(LiteLLM_VerificationToken.token, oldTokenId));
			});

			logger.info(
				`Key rotated: ${oldTokenId.slice(0, TOKEN_LOG_PREFIX_LENGTH)}... -> ${newTokenHash.slice(0, TOKEN_LOG_PREFIX_LENGTH)}...`,
			);

			return {
				success: true,
				key: newPlainKey,
				token: newTokenHash,
			};
		}),
	);
}
