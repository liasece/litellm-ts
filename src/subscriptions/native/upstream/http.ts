/**
 * 上游元信息请求的公共部分。
 *
 * 所有请求只做一件事：发一次带超时的 GET/POST，把 2xx 的 JSON 交回解析器。失败信息
 * 只保留状态码与上游返回的短消息，绝不包含 Authorization 或账号字段。
 */

/** 请求结果：成功带 JSON，失败带可入库的原因。 */
export type UpstreamFetchResult = { readonly ok: true; readonly payload: unknown } | { readonly ok: false; readonly error: string };

/** 单个上游请求的超时（毫秒）。 */
export const UPSTREAM_FETCH_TIMEOUT_MS = 10_000;

/**
 * 发起一次上游请求并解析 JSON。
 * @param url - 完整 URL
 * @param init - fetch 参数（headers/method/body）
 * @param fetchImpl - fetch 实现
 * @param timeoutMs - 超时
 */
export async function fetchUpstreamJson(
	url: string,
	init: RequestInit,
	fetchImpl: typeof fetch,
	timeoutMs: number = UPSTREAM_FETCH_TIMEOUT_MS,
): Promise<UpstreamFetchResult> {
	let response: Response;
	try {
		response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
	} catch (error) {
		return { ok: false, error: error instanceof Error ? `网络请求失败：${error.message}` : "网络请求失败" };
	}
	const text = await response.text().catch(() => "");
	if (!response.ok) {
		const trimmed = text.trim().replace(/\s+/g, " ").slice(0, 200);
		return { ok: false, error: `HTTP ${response.status}${trimmed.length > 0 ? `: ${trimmed}` : ""}` };
	}
	if (text.trim() === "") {
		return { ok: false, error: "上游返回空响应" };
	}
	try {
		return { ok: true, payload: JSON.parse(text) };
	} catch {
		return { ok: false, error: "上游响应不是 JSON" };
	}
}
