/**
 * 认证与授权类型
 *
 * 用于 API 密钥认证、令牌验证和用户权限管理。
 * 参考: LiteLLM Python litellm/proxy/_types.py
 * 参考: 数据库 schema src/db/schema/verification-tokens.ts
 */

/**
 * 用户 API 密钥认证上下文
 *
 * 由认证中间件解析请求头中的 API 密钥，从 LiteLLM_VerificationToken 表中
 * 获取密钥元信息后构造该对象，挂载到请求上下文中。
 */
export interface UserAPIKeyAuth {
	/** 完整 API 密钥原文 */
	api_key: string;
	/** 密钥令牌值（哈希过的主键） */
	token?: string;
	/** 关联的用户 ID */
	user_id?: string;
	/** 关联的团队 ID */
	team_id?: string;
	/** 关联的组织 ID */
	organization_id?: string;
	/** 密钥别名 */
	key_alias?: string;
	/** 允许使用的模型列表（空数组表示无限制） */
	models?: string[];
	/** 当前已花费金额 */
	spend?: number;
	/** 最大预算金额 */
	max_budget?: number;
	/** TPM 限制 */
	tpm_limit?: number;
	/** RPM 限制 */
	rpm_limit?: number;
	/** 附加元数据 */
	metadata?: Record<string, unknown>;
	/** 是否已被阻止 */
	blocked?: boolean;
	/** 权限映射 */
	permissions?: Record<string, unknown>;
	/** 预算重置时间 */
	budget_reset_at?: string;
	/** 令牌过期时间 */
	expires?: string;
	/** 密钥名称 */
	key_name?: string;
	/** 允许的路由列表 */
	allowed_routes?: string[];
	/** 每个模型的单独花费 */
	model_spend?: Record<string, number>;
	/** 每个模型的单独预算 */
	model_max_budget?: Record<string, number>;
	/** 预算 ID */
	budget_id?: string;
	/** 最后活跃时间 */
	last_active?: string;
	/** 最大并行请求数 */
	max_parallel_requests?: number;
	/** 软预算阈值（超出仅告警，不拒绝） */
	soft_budget?: number | null;
	/** 团队模型别名映射（从 team metadata 或 config 中读取） */
	team_model_aliases?: Record<string, string>;
}

/**
 * 令牌元数据 — 从 VerificationToken 数据库行提取的字段子集
 */
export type TokenMetadata = Pick<
	UserAPIKeyAuth,
	| "token"
	| "key_alias"
	| "spend"
	| "max_budget"
	| "models"
	| "tpm_limit"
	| "rpm_limit"
	| "blocked"
	| "metadata"
	| "user_id"
	| "team_id"
	| "organization_id"
	| "budget_reset_at"
	| "expires"
	| "key_name"
>;
