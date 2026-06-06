/**
 * WebUI 支撑端点
 *
 * Python LiteLLM Dashboard 会在首页并发读取一批配置、列表和静态信息。
 * 这些端点不是模型代理核心路径，但缺失会导致复制来的 WebUI 大量 401/404。
 *
 * 本文件拆分为两类：
 * - 公开端点：WebUI 启动时无 cookie 也要拉取（model cost map、provider fields、
 *   model_hub info 等），注册到 publicRouter。
 * - 鉴权端点：依赖 token / master_key 的配置/列表，注册到鉴权 router。
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { createModuleLogger } from "../core/utils/logger";
import type { ServiceConfig } from "../core/config";
import { PROXY_ADMIN_ROLE, PROXY_ADMIN_USER_ID } from "../types/webUiSession";

const logger = createModuleLogger("WebUiSupport");
const DEFAULT_TEAM_LIST_PAGE = 1;
const DEFAULT_TEAM_LIST_PAGE_SIZE = 100;
const EMPTY_COLLECTION_TOTAL_PAGES = 0;
const DAILY_ACTIVITY_DEFAULT_PAGE = 1;
const DAILY_ACTIVITY_TOTAL_PAGES_EMPTY = 1;
/** TypeScript 代理自报版本号（仅文件内使用）。WebUI 把它作为 litellm_version 字面量渲染。 */
const TS_PROXY_VERSION = "0.0.1-ts";

/** WebUI 支持的用户角色（对齐 Python LiteLLM internal user role 字符串）。 */
enum WebUiUserRole {
	PROXY_ADMIN = PROXY_ADMIN_ROLE,
	PROXY_ADMIN_VIEWER = "proxy_admin_viewer",
	INTERNAL_USER = "internal_user",
	INTERNAL_USER_VIEWER = "internal_user_viewer",
}

const WEB_UI_AVAILABLE_ROLES: readonly WebUiUserRole[] = [
	WebUiUserRole.PROXY_ADMIN,
	WebUiUserRole.PROXY_ADMIN_VIEWER,
	WebUiUserRole.INTERNAL_USER,
	WebUiUserRole.INTERNAL_USER_VIEWER,
];

/**
 * Usage 页面每日活动响应。
 * `results` 是明细/聚合行；`metadata` 是分页与总量汇总。当前 TS 端返回空态契约，避免 WebUI new_usage 在无数据时卡住。
 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/UsagePage/hooks/usePaginatedDailyActivity.ts
 */
interface DailyActivityResponse {
	readonly results: unknown[];
	readonly metadata: {
		readonly total_spend: number;
		readonly total_prompt_tokens: number;
		readonly total_completion_tokens: number;
		readonly total_tokens: number;
		readonly total_api_requests: number;
		readonly total_successful_requests: number;
		readonly total_failed_requests: number;
		readonly total_cache_read_input_tokens: number;
		readonly total_cache_creation_input_tokens: number;
		readonly total_pages: number;
		readonly has_more: boolean;
		readonly page: number;
	};
}

function makeEmptyDailyActivityResponse(): DailyActivityResponse {
	return {
		results: [],
		metadata: {
			total_spend: 0,
			total_prompt_tokens: 0,
			total_completion_tokens: 0,
			total_tokens: 0,
			total_api_requests: 0,
			total_successful_requests: 0,
			total_failed_requests: 0,
			total_cache_read_input_tokens: 0,
			total_cache_creation_input_tokens: 0,
			total_pages: DAILY_ACTIVITY_TOTAL_PAGES_EMPTY,
			has_more: false,
			page: DAILY_ACTIVITY_DEFAULT_PAGE,
		},
	};
}

/**
 * WebUI 启动偏好响应，供 dashboard 在登录前后读取默认 UI 配置。
 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx
 */
interface UiSettingsResponse {
	readonly success: boolean;
	readonly ui_settings: Record<string, unknown>;
}

/**
 * 表单字段类型（对齐 WebUI CredentialField.field_type）
 * - TEXT: 单行文本输入
 * - PASSWORD: 密码输入，UI 隐藏明文
 * - SELECT: 下拉选择（options 必填）
 * - UPLOAD: 文件上传
 * - TEXTAREA: 多行文本输入
 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx CredentialField
 */
enum CredentialFieldType {
	TEXT = "text",
	PASSWORD = "password",
	SELECT = "select",
	UPLOAD = "upload",
	TEXTAREA = "textarea",
}

/**
 * `/config/list` general_settings 字段类型（对齐 Python LiteLLM
 * `litellm/proxy/proxy_server.py::get_config_list` 返回的 `field_type` 字符串）。
 * 字符串值需与 WebUI `useProxyConfig` 直接渲染的 `field_type` 字面量一致，
 * 因此保持 PascalCase 字面量（"Integer" / "Boolean" / "String" / "List" / "PydanticModel"），
 * 不可改为 lowercase。
 * - INTEGER: 整型配置（如 max_parallel_requests、max_request_size_mb）
 * - BOOLEAN: 布尔配置（如 store_model_in_db、always_include_stream_usage）
 * - STRING: 字符串配置（如 maximum_spend_logs_retention_period）
 * - LIST: 列表配置（如 mcp_internal_ip_ranges）
 * - PYDANTIC_MODEL: 复杂结构配置（如 pass_through_endpoints）
 * @see https://github.com/BerriAI/litellm/blob/main/litellm/proxy/proxy_server.py get_config_list
 */
enum ConfigFieldType {
	INTEGER = "Integer",
	BOOLEAN = "Boolean",
	STRING = "String",
	LIST = "List",
	PYDANTIC_MODEL = "PydanticModel",
}

/**
 * Provider 凭据字段元数据：WebUI 用它渲染 Add Model / Credentials 表单。
 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx ProviderCreateInfo
 */
interface ProviderCredentialFieldMetadata {
	readonly key: string;
	readonly label: string;
	readonly placeholder?: string | null;
	readonly tooltip?: string | null;
	readonly required?: boolean;
	readonly field_type?: CredentialFieldType;
	readonly options?: string[] | null;
	readonly default_value?: string | null;
}

/**
 * Provider 创建表单描述，返回给 WebUI provider 字段发现接口。
 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx ProviderCreateInfo
 */
interface ProviderCreateInfo {
	readonly provider: string;
	readonly provider_display_name: string;
	readonly litellm_provider: string;
	readonly default_model_placeholder?: string | null;
	readonly credential_fields: ProviderCredentialFieldMetadata[];
}

/**
 * Agent 类型字段元数据：WebUI 用它渲染 Agent Hub 创建表单。
 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx AgentCreateInfo
 */
interface AgentCredentialFieldMetadata {
	readonly key: string;
	readonly label: string;
	readonly placeholder?: string | null;
	readonly tooltip?: string | null;
	readonly required?: boolean;
	readonly field_type?: CredentialFieldType;
	readonly options?: string[] | null;
	readonly default_value?: string | null;
	readonly include_in_litellm_params?: boolean;
}

/**
 * Agent 创建表单描述，返回给 WebUI agent 字段发现接口。
 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx AgentCreateInfo
 */
interface AgentCreateInfo {
	readonly agent_type: string;
	readonly agent_type_display_name: string;
	readonly description?: string | null;
	readonly logo_url?: string | null;
	readonly credential_fields: AgentCredentialFieldMetadata[];
	readonly litellm_params_template?: Record<string, string> | null;
	readonly model_template?: string | null;
	readonly use_a2a_form_fields?: boolean;
}

/**
 * 注册 WebUI 公开支撑端点（无鉴权）。
 *
 * 这些端点在 WebUI 启动/首页加载时即被请求，缺失或鉴权会触发 401/404。
 * @param router - publicRouter（无 authMiddleware）
 */
export function registerWebUiSupportPublicRoutes(router: Router): void {
	const emptyObject = (): Record<string, unknown> => ({});
	const uiSettings = (): UiSettingsResponse => ({ success: true, ui_settings: {} });

	// ── UI 偏好（无 cookie 时也要返回默认值） ──

	/** UI 偏好设置，WebUI 启动时无 token 也需要 */
	registerRoute(router, { method: "get", path: "/get/ui_settings" }, uiSettings);

	/** UI 主题设置 */
	registerRoute(router, { method: "get", path: "/get/ui_theme_settings" }, emptyObject);

	/** SSO UI 偏好（dashboard 启动时拉取） */
	registerRoute(router, { method: "get", path: "/sso/get/ui_settings" }, () => ({ values: {}, sso_settings: {} }));

	/** get_image 占位（避免 401/404） */
	registerRoute(router, { method: "get", path: "/get_image" }, (_req, res) => {
		res.status(204).end();
	});

	// ── 公开端点：model cost map ──

	/** 模型成本映射表，WebUI 用于显示 provider 和定价信息 */
	registerRoute(router, { method: "get", path: "/public/litellm_model_cost_map" }, () => ({}));

	/** 公开博客文章列表（无鉴权） */
	registerRoute(router, { method: "get", path: "/public/litellm_blog_posts" }, () => ({ posts: [] }));

	/** 公开模型中心（WebUI AI Hub "Model Hub" tab） */
	registerRoute(router, { method: "get", path: "/public/model_hub" }, () => []);

	/** 公开 Agent 中心（WebUI AI Hub "Agent Hub" tab） */
	registerRoute(router, { method: "get", path: "/public/agent_hub" }, () => []);

	/** 公开 MCP 中心（WebUI AI Hub "MCP Hub" tab） */
	registerRoute(router, { method: "get", path: "/public/mcp_hub" }, () => []);

	/** Claude Code 插件市场（WebUI AI Hub "Claude Code Plugin Marketplace" tab） */
	registerRoute(router, { method: "get", path: "/claude-code/marketplace.json" }, () => ({ plugins: [] }));

	/** Provider 凭据字段元数据，WebUI 用于动态渲染 provider 特定的表单 */
	registerRoute(router, { method: "get", path: "/public/providers/fields" }, (): ProviderCreateInfo[] => []);

	/** Agent 类型字段元数据，WebUI 用于动态渲染 agent 特定的表单 */
	registerRoute(router, { method: "get", path: "/public/agents/fields" }, (): AgentCreateInfo[] => []);

	/**
	 * 公开模型中心信息。
	 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx modelHubInfoCall
	 */
	registerRoute(router, { method: "get", path: "/public/model_hub/info" }, () => ({
		docs_title: "LiteLLM Proxy",
		custom_docs_description: null,
		litellm_version: TS_PROXY_VERSION,
		useful_links: {},
	}));
}

/**
 * 注册 WebUI 鉴权支撑端点。
 * @param router - 已经过鉴权的 Router
 * @param config - 服务配置
 */
export function registerWebUiSupportRoutes(router: Router, config: ServiceConfig): void {
	const emptyList = (): unknown[] => [];

	// 注：/get/ui_settings、/get/ui_theme_settings、/sso/get/ui_settings、/get_image、
	// /public/litellm_blog_posts 等无需鉴权的端点已移到 registerWebUiSupportPublicRoutes

	/**
	 * 列出某类配置的可用字段及当前值。
	 *
	 * Python LiteLLM 实现见 `litellm/proxy/proxy_server.py:12225-12371`
	 * （`get_config_list`），返回 `List[ConfigList]`，每个元素含 `field_name`、
	 * `field_type`、`field_description`、`field_value`、`stored_in_db`、
	 * `field_default_value`、`premium_field?`、`nested_fields?`（`_types.py:2096-2114`）。
	 * 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/proxy_server.py
	 *
	 * WebUI `useProxyConfig` 直接对返回值调用 `.find`（如
	 * `n.find(e => e.field_name === "store_model_in_db")`），所以必须返回数组而不是
	 * 按顶级配置节分组的对象。ModelSettingsModal 渲染时也会读取 `field_value`、
	 * `field_default_value`、`stored_in_db` 等字段；删除字段会让对应设置项在 WebUI 不可配置。
	 */
	const generalSettingsFields: ReadonlyArray<{
		readonly field_name: string;
		readonly field_type: ConfigFieldType;
		readonly field_description: string;
		readonly field_default_value: unknown;
	}> = [
		{
			field_name: "max_parallel_requests",
			field_type: ConfigFieldType.INTEGER,
			field_description: "maximum parallel requests for each api key",
			field_default_value: null,
		},
		{
			field_name: "global_max_parallel_requests",
			field_type: ConfigFieldType.INTEGER,
			field_description: "global max parallel requests to allow for a proxy instance.",
			field_default_value: null,
		},
		{
			field_name: "max_request_size_mb",
			field_type: ConfigFieldType.INTEGER,
			field_description: "max request size in MB, if a request is larger than this size it will be rejected",
			field_default_value: null,
		},
		{
			field_name: "max_response_size_mb",
			field_type: ConfigFieldType.INTEGER,
			field_description: "max response size in MB, if a response is larger than this size it will be rejected",
			field_default_value: null,
		},
		{
			field_name: "pass_through_endpoints",
			field_type: ConfigFieldType.PYDANTIC_MODEL,
			field_description: "list of pass-through endpoints",
			field_default_value: null,
		},
		{
			field_name: "store_model_in_db",
			field_type: ConfigFieldType.BOOLEAN,
			field_description: "store model definitions in the database",
			field_default_value: null,
		},
		{
			field_name: "store_prompts_in_spend_logs",
			field_type: ConfigFieldType.BOOLEAN,
			field_description: "store prompt text in spend logs",
			field_default_value: null,
		},
		{
			field_name: "maximum_spend_logs_retention_period",
			field_type: ConfigFieldType.STRING,
			field_description: "retention period for spend logs (e.g. '30d')",
			field_default_value: null,
		},
		{
			field_name: "mcp_internal_ip_ranges",
			field_type: ConfigFieldType.LIST,
			field_description: "internal IP ranges allowed to call MCP servers",
			field_default_value: null,
		},
		{
			field_name: "mcp_trusted_proxy_ranges",
			field_type: ConfigFieldType.LIST,
			field_description: "trusted proxy IP ranges for MCP",
			field_default_value: null,
		},
		{
			field_name: "always_include_stream_usage",
			field_type: ConfigFieldType.BOOLEAN,
			field_description: "always include usage in streaming responses",
			field_default_value: null,
		},
		{
			field_name: "forward_client_headers_to_llm_api",
			field_type: ConfigFieldType.BOOLEAN,
			field_description: "forward client headers to the upstream LLM API",
			field_default_value: null,
		},
		{
			field_name: "mcp_required_fields",
			field_type: ConfigFieldType.LIST,
			field_description: "required fields for MCP server configurations",
			field_default_value: null,
		},
	];

	registerRoute(router, { method: "get", path: "/config/list" }, (req) => {
		const configType = (req.query.config_type as string | undefined) ?? "general_settings";
		if (configType !== "general_settings") {
			// 未知 config_type 静默返回空数组会导致 WebUI 永远不感知该 type 不被支持；
			// 打 warn 让运维能定位"为什么配置页某些高级 type 永远空白"。
			logger.warn(`/config/list unsupported config_type=${configType}, returning empty array`);
			return [];
		}
		const generalSettings = config.generalSettingsRaw ?? {};
		return generalSettingsFields.map((field) => {
			const fieldValue = field.field_name in generalSettings ? (generalSettings as Record<string, unknown>)[field.field_name] : null;
			const storedInDb = field.field_name in generalSettings ? false : null;
			return {
				field_name: field.field_name,
				field_type: field.field_type,
				field_description: field.field_description,
				field_value: fieldValue,
				stored_in_db: storedInDb,
				field_default_value: field.field_default_value,
				premium_field: false,
				nested_fields: null,
			};
		});
	});
	registerRoute(router, { method: "get", path: "/callbacks/configs" }, emptyList);
	registerRoute(router, { method: "get", path: "/user/available_users" }, () => ({ users: [] }));
	registerRoute(router, { method: "get", path: "/user/available_roles" }, () => WEB_UI_AVAILABLE_ROLES);
	registerRoute(router, { method: "get", path: "/health/license" }, () => ({ premium_user: false, expires: null }));
	// /team/list 由 createTeamRoutes（managementRouter）提供，返回纯数组匹配 Python
	// /v2/team/list WebUI v2TeamListCall 期望 TeamListResponse 对象 { teams, total, page, page_size, total_pages }
	//
	// STUB 说明：
	//   - 当前 v2 端点不支持任何过滤/分页/排序查询参数 — 一律返回空 page=1。
	//   - 真实实现应支持 user_id / organization_id / team_id / team_alias 过滤
	//     与 sort_by / sort_order / page / page_size 排序与分页（见 Python
	//     `litellm/proxy/management_endpoints/team_endpoints.py` 的 v2 端点）。
	//   - WebUI `v2TeamListCall`（networking.tsx L1420+）当前对此端点的容错良好：
	//     拿到空列表会渲染空表格，不会崩溃 — 因此 stub 不会引起前端报错。
	//   - 实现优先级低于 `/team/list`（该接口已在 TeamEndpoint 中提供真实 DB 查询）。
	//     在 v2 接口实现前请勿下架 `/team/list`，否则会破坏 v1 调用方。
	registerRoute(router, { method: "get", path: "/v2/team/list" }, () => ({
		teams: [],
		total: 0,
		page: DEFAULT_TEAM_LIST_PAGE,
		page_size: DEFAULT_TEAM_LIST_PAGE_SIZE,
		total_pages: EMPTY_COLLECTION_TOTAL_PAGES,
	}));
	registerRoute(router, { method: "get", path: "/organization/list" }, emptyList);
	registerRoute(router, { method: "get", path: "/project/list" }, emptyList);
	registerRoute(router, { method: "get", path: "/tag/list" }, emptyList);
	registerRoute(router, { method: "get", path: "/access_groups/list" }, emptyList);
	registerRoute(router, { method: "get", path: "/v1/access_group" }, emptyList);
	registerRoute(router, { method: "get", path: "/in_product_nudges" }, emptyList);
	/** 预算列表（WebUI Budgets 页面 — 直接返回数组） */
	registerRoute(router, { method: "get", path: "/budget/list" }, emptyList);
	registerRoute(router, { method: "get", path: "/guardrails/list" }, () => ({ guardrails: [] }));
	registerRoute(router, { method: "get", path: "/v2/guardrails/list" }, () => ({ guardrails: [] }));
	registerRoute(router, { method: "get", path: "/policies/list" }, () => ({ policies: [] }));
	/**
	 * 当前 WebUI 会话用户信息；登录后全局 layout 用它决定权限与菜单。
	 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx userInfoCall
	 */
	registerRoute(router, { method: "get", path: "/v2/user/info" }, () => ({
		user_id: PROXY_ADMIN_USER_ID,
		user_email: null,
		user_alias: null,
		user_role: WebUiUserRole.PROXY_ADMIN,
		spend: 0,
		max_budget: null,
		models: [],
		budget_duration: null,
		budget_reset_at: null,
		metadata: {},
		created_at: null,
		updated_at: null,
		sso_user_id: null,
		teams: [],
	}));
	registerRoute(router, { method: "get", path: "/v1/agents" }, () => []);
	registerRoute(router, { method: "get", path: "/prompts/list" }, () => ({ prompts: [], data: [] }));

	// ── Playground 页面依赖的列表端点 ──

	/** 列出 Vector Stores，WebUI Playground 选择器使用 */
	registerRoute(router, { method: "get", path: "/vector_store/list" }, () => []);

	/** 列出 MCP Servers（WebUI Playground MCP 列表） */
	registerRoute(router, { method: "get", path: "/v1/mcp/server" }, () => []);

	// ── 用户设置端点 ──

	/** 内部用户设置（UI 偏好等） */
	registerRoute(router, { method: "get", path: "/get/internal_user_settings" }, () => ({
		settings: {},
	}));

	/** 更新内部用户设置 */
	registerRoute(router, { method: "patch", path: "/update/internal_user_settings" }, () => ({
		success: true,
	}));

	// ── Guardrails 页面依赖的子端点 ──

	/** Guardrails UI 添加表单设置（Presidio / Bedrock / OpenAI 等 provider 通用选项） */
	registerRoute(router, { method: "get", path: "/guardrails/ui/add_guardrail_settings" }, () => ({}));

	/** Guardrail provider 特定参数（不同 provider 表单字段元数据） */
	registerRoute(router, { method: "get", path: "/guardrails/ui/provider_specific_params" }, () => ({}));

	/**
	 * 用户提交的 Guardrails（WebUI Guardrails 页面 "Submitted Guardrails" tab）。
	 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx
	 */
	registerRoute(router, { method: "get", path: "/guardrails/submissions" }, () => ({
		items: [],
		total: 0,
		pending_review: 0,
		active: 0,
		rejected: 0,
	}));

	/**
	 * Guardrails Monitor 概览（按时间范围聚合评估次数、阻止数、通过率等）。
	 * @see https://github.com/BerriAI/litellm/blob/main/ui/litellm-dashboard/src/components/networking.tsx
	 */
	registerRoute(router, { method: "get", path: "/guardrails/usage/overview" }, () => ({
		total_evaluations: 0,
		blocked_requests: 0,
		passed_requests: 0,
		pass_rate: 0,
		avg_latency_ms: 0,
		active_guardrails: 0,
		timeseries: [],
		guardrails: [],
	}));

	// ── Policies 页面依赖的子端点 ──

	/** 策略模板（WebUI Policies 页面 "Templates" tab，期望纯数组） */
	registerRoute(router, { method: "get", path: "/policy/templates" }, emptyList);

	/** 策略附件列表（WebUI Policies 页面 "Attachments" tab，期望纯数组） */
	registerRoute(router, { method: "get", path: "/policies/attachments/list" }, emptyList);

	// ── Usage / Logs 页面依赖的子端点 ──

	/** 用户每日活动聚合（Usage 页面 "Daily Spend" 图表） */
	registerRoute(router, { method: "get", path: "/user/daily/activity/aggregated" }, makeEmptyDailyActivityResponse);

	/** 用户每日活动（Usage 页面 Top Virtual Keys 表格） */
	registerRoute(router, { method: "get", path: "/user/daily/activity" }, makeEmptyDailyActivityResponse);

	/** 客户列表（Customer-based usage tab） */
	registerRoute(router, { method: "get", path: "/customer/list" }, () => []);
}
