/**
 * WebUI 会话协议常量
 *
 * 中性模块：避免 auth 层反向 import proxy/LoginEndpoints
 * 引入循环依赖。所有 WebUI session / role 相关的字面量在此定义。
 *
 * 协议说明：cookie JWT 中 `key` 字段约定为真实明文 virtual key（`sk-...`），
 * 与 Python LiteLLM Proxy `authenticate_user()` 一致 —— 登录成功后通过
 * `generate_key_helper_fn()` 生成 `sk-*` 明文 key，DB 仅保存 hash，
 * WebUI 通过 `jwtDecode(token)` 读取 `claims.key` 后挂到 `Authorization` 头
 * 发请求。auth 层按 Bearer 走 hash → DB 查找路径。
 */

/** WebUI 登录 JWT cookie 名称，对齐 Python LiteLLM Dashboard 协议 */
export const WEBUI_COOKIE_TOKEN_NAME = "token";

/** 登录方式 — 用于 cookie JWT claims，对齐 WebUI LoginMethod 联合 */
export const LOGIN_METHOD_USERNAME_PASSWORD = "username_password";

/** proxy_admin 会话的用户 ID 字面量 */
export const PROXY_ADMIN_USER_ID = "default_user_id";

/** proxy_admin 角色字面量 */
export const PROXY_ADMIN_ROLE = "proxy_admin";

/** Python LiteLLM internal_user 角色字面量 */
export const INTERNAL_USER_ROLE = "internal_user";

/** Python LiteLLM internal_user_viewer 角色字面量 */
export const INTERNAL_USER_VIEWER_ROLE = "internal_user_viewer";

/** 通用 JWT 回退用户 ID（claims 中无 sub/user_id 时使用） */
export const JWT_FALLBACK_USER_ID = "jwt-user";

/** WebUI 登录自动生成的 virtual key 关联的团队 ID（Python LiteLLM 同语义） */
export const WEBUI_LOGIN_TEAM_ID = "litellm-dashboard";
