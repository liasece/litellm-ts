/**
 * Antigravity 订阅的 OAuth 与 Cloud Code 常量。
 *
 * 端点、client_id/secret、scope、回调地址与 User-Agent 都对齐 Go 实现
 * `internal/auth/antigravity`（CLIProxyAPI v8.0.57），保证已有账号与
 * 旧运行时可以继续互相读写。
 */

/** Antigravity auth 文件的 `type` 字段。 */
export const ANTIGRAVITY_AUTH_TYPE = "antigravity";

/** Google OAuth 客户端 ID（与 Go 实现一致）。 */
export const ANTIGRAVITY_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";

/** Google OAuth 客户端密钥；桌面客户端类型，并非服务端机密。 */
export const ANTIGRAVITY_CLIENT_SECRET = "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";

/** Go 实现默认的本地回调端口。 */
export const ANTIGRAVITY_CALLBACK_PORT = 51121;

/** OAuth 回调地址；手动粘贴回调 URL 时仍按此值换取 token。 */
export const ANTIGRAVITY_REDIRECT_URI = `http://localhost:${ANTIGRAVITY_CALLBACK_PORT}/oauth-callback`;

/** Google 授权端点。 */
export const ANTIGRAVITY_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/** Google token 端点，授权码换取与刷新共用。 */
export const ANTIGRAVITY_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Google 用户信息端点。 */
export const ANTIGRAVITY_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo?alt=json";

/** Cloud Code（Antigravity 控制面）端点。 */
export const ANTIGRAVITY_CLOUDCODE_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";

/** Cloud Code API 版本段。 */
export const ANTIGRAVITY_API_VERSION = "v1internal";

/** 账号需要的 Google OAuth scope；顺序与 Go 实现一致。 */
export const ANTIGRAVITY_SCOPES: readonly string[] = [
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/aicode",
	"https://www.googleapis.com/auth/cclog",
	"https://www.googleapis.com/auth/experimentsandconfigs",
];

/**
 * 上报的 Antigravity Hub 客户端版本。
 *
 * Go 实现会定期从 hub manifest 拉取最新版本，取不到时回退到该值；这里只保留
 * 回退值，避免登录链路依赖额外网络与后台任务。
 */
export const ANTIGRAVITY_CLIENT_VERSION = "2.29.0";

/** 2.29.0 对应的 Hub changelist，用于拼出与 Go 完全一致的 UA。 */
const ANTIGRAVITY_CLIENT_CHANGELIST = "1013060670";

/** Antigravity 运行时 User-Agent（loadCodeAssist / userinfo 使用）。 */
export const ANTIGRAVITY_USER_AGENT = `antigravity/hub/${ANTIGRAVITY_CLIENT_VERSION} (aidev_client; os_type=darwin; arch=arm64; cl=${ANTIGRAVITY_CLIENT_CHANGELIST})`;

/** onboardUser 使用的长 User-Agent（追加 Node 客户端标识）。 */
export const ANTIGRAVITY_ONBOARD_USER_AGENT = `${ANTIGRAVITY_USER_AGENT} google-api-nodejs-client/10.3.0`;

/** onboardUser 请求的 X-Goog-Api-Client。 */
export const ANTIGRAVITY_GOOG_API_CLIENT = "gl-node/22.21.1";

/** loadCodeAssist 的 metadata。 */
export const ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA: Readonly<Record<string, string>> = { ideType: "ANTIGRAVITY" };

/** onboardUser 的轮询次数上限。 */
export const ANTIGRAVITY_ONBOARD_ATTEMPTS = 5;

/** onboardUser 两次轮询之间的等待毫秒数。 */
export const ANTIGRAVITY_ONBOARD_POLL_MS = 2_000;

/**
 * onboardUser 使用的控制面 metadata。
 * @param version - Antigravity 版本
 */
export function antigravityControlPlaneMetadata(version: string): Record<string, string> {
	return { ide_type: "ANTIGRAVITY", ide_version: version, ide_name: "antigravity" };
}
