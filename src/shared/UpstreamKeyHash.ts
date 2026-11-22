import { createHash } from "node:crypto";

/**
 * 订阅 / 直连请求最终实际发送的 key 的指纹。
 *
 * 只哈希密钥本身，不混入 provider、账号或请求 ID：同一个 key 无论在哪个部署、
 * 哪次请求里出现，指纹都相同，Usage 才能把它归到同一行。账号归属由
 * `LiteLLM_UpstreamKeyAccount` 关联表承担，不进入这个指纹。
 * @param secret - 实际进入上游鉴权头的字符串
 */
export function hashUpstreamKey(secret: string): string {
	return createHash("sha256").update(secret).digest("hex");
}

/**
 * 解析直连 deployment 实际使用的字符串 key。
 *
 * 目前只有 AnthropicProvider 把 `auth_token` 当作 Bearer；其它 Provider 读
 * `api_key`。不要为了“看起来有值”而回退到未发送的字段，否则会把另一把 key
 * 的指纹记到这次请求上。
 * @param params - 已合并 Credential 值的 deployment 参数
 * @param provider - 实际执行的 provider
 * @returns 实际发送的 key；没有可哈希的字符串时 undefined
 */
export function resolveDirectUpstreamSecret(params: Readonly<Record<string, unknown>>, provider: string): string | undefined {
	const apiKey = stringSecret(params["api_key"]);
	const authToken = stringSecret(params["auth_token"]);
	return provider === "anthropic" ? (authToken ?? apiKey) : apiKey;
}

/**
 * 只接受非空字符串；数字、对象和空串都不算可用的上游 key。
 * @param value - 原始参数值
 */
function stringSecret(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}
