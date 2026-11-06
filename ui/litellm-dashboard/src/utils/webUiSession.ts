/**
 * WebUI 会话凭据在 WebSocket 握手里的表达方式。
 *
 * Dashboard 用后端 HttpOnly cookie 会话鉴权，前端并不持有密钥；旧组件需要一个 truthy
 * 的登录标记，因此用固定占位值通过门禁，它不是凭据，也不能当作密钥提交。
 *
 * 浏览器无法在 WebSocket 握手里设置 Authorization 头，服务端为此支持 `litellm_<key>`
 * 子协议；但服务端取值时子协议优先于同源 Cookie，把占位值当密钥提交会让一个无效密钥
 * 参与鉴权并失败。同源握手本来就会带上 HttpOnly Cookie，所以只有真正持有密钥时才交出
 * 子协议。
 */

/** 已登录但没有密钥时的固定标记。 */
export const WEB_UI_COOKIE_SESSION_SENTINEL = "cookie-session";

/** 服务端识别的密钥子协议前缀，与 src/auth/UserApiKeyAuth.ts 保持一致。 */
const WS_AUTH_SUBPROTOCOL_PREFIX = "litellm_";

/**
 * 构造握手子协议里的凭据片段；cookie 会话下返回空数组。
 * @param accessToken - 当前会话可用的密钥，或 `WEB_UI_COOKIE_SESSION_SENTINEL`
 */
export const buildWebSocketCredentialProtocols = (accessToken: string | null | undefined): string[] =>
	accessToken && accessToken !== WEB_UI_COOKIE_SESSION_SENTINEL ? [`${WS_AUTH_SUBPROTOCOL_PREFIX}${accessToken}`] : [];
