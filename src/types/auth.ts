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
/** 单个独立预算主体在认证时读取的快照。 */
export interface BudgetSnapshot {
	/** 主体稳定标识。 */
	readonly id: string;
	/** 已提交消费。 */
	readonly spend: number;
	/** 主体最大预算；null 表示未设置硬预算。 */
	readonly max_budget: number | null;
	/** 关联预算记录 ID（适用于组织、项目和团队成员）。 */
	readonly budget_id?: string;
}

/** 请求涉及的独立预算主体快照。 */
export interface BudgetSnapshots {
	/** API key 预算。 */
	key?: BudgetSnapshot;
	/** 用户预算。 */
	user?: BudgetSnapshot;
	/** 团队预算。 */
	team?: BudgetSnapshot;
	/** 组织预算。 */
	organization?: BudgetSnapshot;
	/** 项目预算。 */
	project?: BudgetSnapshot;
	/** 团队成员预算。 */
	team_member?: BudgetSnapshot;
	/** 端用户预算。 */
	end_user?: BudgetSnapshot;
}

/**
 *
 */
export interface UserAPIKeyAuth {
	/** 完整 API 密钥原文 */
	api_key: string;
	/** 密钥令牌值（哈希过的主键） */
	token?: string;
	/** 关联的用户 ID */
	user_id?: string;
	/**
	 * 关联的用户角色（proxy_admin / internal_user 等），对齐 PY UserAPIKeyAuth.user_role。
	 * 主要由 WebUI 登录会话 JWT（cookie `token`）携带，由登录端点写入 claims.user_role。
	 * 完整定义：BerriAI/litellm `litellm/proxy/_types.py::UserAPIKeyAuth.user_role`。
	 */
	user_role?: string;
	/** 关联的团队 ID */
	team_id?: string;
	/**
	 * 关联的团队别名（LiteLLM_TeamTable.team_alias），由 UserApiKeyAuth 中间件
	 * 在 DB 分支查询团队时带出，供 SpendLogs metadata.user_api_key_team_alias 使用。
	 * 对齐 PY UserAPIKeyAuth.user_api_key_team_alias。
	 */
	team_alias?: string;
	/** 关联的组织 ID */
	organization_id?: string;
	/** 关联的项目 ID */
	project_id?: string;
	/** 密钥别名 */
	key_alias?: string;
	/** 允许使用的模型列表（空数组表示无限制） */
	models?: string[];
	/** API key 主体当前已提交花费；不再与 team spend 合并。 */
	spend?: number;
	/** API key 主体最大预算；不再回退为 team budget。 */
	max_budget?: number;
	/** 请求涉及的各主体独立预算快照。 */
	budget_snapshots?: BudgetSnapshots;
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
	/**
	 * GAP 10: 端用户 ID — 由 UserApiKeyAuth 中间件从请求体 user 字段或
	 * x-end-user-id header 提取，挂到 req.auth.end_user_id 供下游 spend log 使用。
	 * 对齐 PY get_end_user_id_for_cost_tracking(litellm_params) 路径。
	 */
	end_user_id?: string;
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
	| "project_id"
	| "budget_reset_at"
	| "expires"
	| "key_name"
>;
