/** WebUI 会话协议常量与安全边界。 */

/** HttpOnly WebUI 登录 JWT cookie。 */
export const WEBUI_COOKIE_TOKEN_NAME = "token";

/** 可由 Dashboard 读取并回传的 double-submit CSRF cookie。 */
export const WEBUI_CSRF_COOKIE_NAME = "litellm_csrf_token";

/** Dashboard 写请求携带 CSRF token 的 header。 */
export const WEBUI_CSRF_HEADER_NAME = "x-litellm-csrf-token";

/** WebUI session duration 环境变量。 */
export const WEBUI_SESSION_DURATION_ENV_VAR = "LITELLM_UI_SESSION_DURATION";

/** Python LiteLLM 默认 UI session duration。 */
export const DEFAULT_WEBUI_SESSION_DURATION = "24h";

/** 登录方式。 */
export const LOGIN_METHOD_USERNAME_PASSWORD = "username_password";

/** proxy_admin 会话的用户 ID。 */
export const PROXY_ADMIN_USER_ID = "default_user_id";

/** proxy_admin 角色。 */
export const PROXY_ADMIN_ROLE = "proxy_admin";

/** Python LiteLLM internal_user 角色。 */
export const INTERNAL_USER_ROLE = "internal_user";

/** Python LiteLLM internal_user_viewer 角色。 */
export const INTERNAL_USER_VIEWER_ROLE = "internal_user_viewer";

/** 通用 JWT 回退用户 ID。 */
export const JWT_FALLBACK_USER_ID = "jwt-user";

/** WebUI session 记录关联的团队 ID。 */
export const WEBUI_LOGIN_TEAM_ID = "litellm-dashboard";

/** WebUI JWT claims。绝不包含 API key、master key 或 CSRF token。 */
export interface WebUiSessionClaims extends Record<string, unknown> {
	/**
	 *
	 */
	readonly user_id: string;
	/**
	 *
	 */
	readonly user_email: string | null;
	/**
	 *
	 */
	readonly user_role: string;
	/**
	 *
	 */
	readonly login_method: typeof LOGIN_METHOD_USERNAME_PASSWORD;
	/**
	 *
	 */
	readonly premium_user: boolean;
	/**
	 *
	 */
	readonly disabled_non_admin_personal_key_creation: boolean;
	/**
	 *
	 */
	readonly server_root_path: string;
	/**
	 *
	 */
	readonly webui_session: true;
	/**
	 *
	 */
	readonly iat: number;
	/**
	 *
	 */
	readonly exp: number;
	/**
	 *
	 */
	readonly jti: string;
}

/** Dashboard 可见的非敏感 session 信息。 */
export interface WebUiSessionInfo {
	/**
	 *
	 */
	readonly authenticated: true;
	/**
	 *
	 */
	readonly user_id: string;
	/**
	 *
	 */
	readonly user_email: string | null;
	/**
	 *
	 */
	readonly user_role: string;
	/**
	 *
	 */
	readonly login_method: string;
	/**
	 *
	 */
	readonly premium_user: boolean;
	/**
	 *
	 */
	readonly disabled_non_admin_personal_key_creation: boolean;
	/**
	 *
	 */
	readonly server_root_path: string;
}
