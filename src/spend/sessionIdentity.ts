/**
 * 会话身份解析：把各客户端声明的稳定任务 ID 归一成持久化分组键 `s:<uuid>`。
 *
 * 同一件事在不同客户端有不同写法，只认裸 UUID 会漏掉它们，于是 SpendLog 退回请求级
 * `session_id`，每个请求各自成组：
 * - OpenAI Responses/Codex 用 `client_metadata.thread_id` / `client_metadata.session_id`；
 * - DeepSeek Harness 用 `session_id` 请求头，并把它同时写进 `prompt_cache_key`；
 * - 部分客户端给稳定 UUID 加 `session-` 前缀，如 `session-2e24587f-…`。
 *
 * 归一后只保留小写裸 UUID，使请求写入、`litellm_session_group_key` 的规范分支与历史
 * 回填迁移得到同一个分组键。
 */

/** Claude Code 写入 `metadata.spend_logs_metadata.user_id` 的稳定用户 ID。 */
export const CLAUDE_CODE_USER_ID_PATTERN =
	/^user_[A-Za-z0-9_-]+_account_[A-Za-z0-9_-]*_session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 裸会话 UUID。 */
export const SESSION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `<label>-<uuid>` / `<label>_<uuid>`：客户端声明的带前缀会话 ID。 */
const PREFIXED_SESSION_UUID_PATTERN =
	/^[a-z][a-z0-9]{0,31}[-_]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** 会话 ID 请求头：Harness 用下划线写法，Codex 用连字符写法。 */
const SESSION_ID_HEADERS = ["session_id", "session-id"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 提取候选值里的会话 UUID。
 * @param value - 客户端声明的线程/会话/缓存键
 * @returns 小写裸 UUID；不是可识别的会话标识时为 null
 */
export function normalizeSessionUuid(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	if (SESSION_UUID_PATTERN.test(trimmed)) {
		return trimmed.toLowerCase();
	}
	const prefixedUuid = PREFIXED_SESSION_UUID_PATTERN.exec(trimmed)?.[1];
	return prefixedUuid === undefined ? null : prefixedUuid.toLowerCase();
}

/**
 * 读取请求头里的会话 ID；重复头取第一个。
 * @param headers - Express 请求头
 * @param name - 请求头名称
 */
function readSessionIdHeader(headers: Record<string, unknown>, name: string): unknown {
	const raw = headers[name];
	return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Claude Code 的会话整体由 `user_…_account_…_session_…` 分组；同一个请求即使还带了
 * 会话头也不能把会话拆开，因此这里让出分组优先级。
 * @param requestBody - 请求体
 */
function hasClaudeCodeUserId(requestBody: Record<string, unknown> | undefined): boolean {
	const metadata = requestBody?.metadata;
	if (!isRecord(metadata)) {
		return false;
	}
	const spendMetadata = metadata.spend_logs_metadata;
	if (!isRecord(spendMetadata)) {
		return false;
	}
	const userId = spendMetadata.user_id;
	return typeof userId === "string" && CLAUDE_CODE_USER_ID_PATTERN.test(userId.trim());
}

/**
 * 解析一次请求的规范会话分组键。
 *
 * 优先级：`client_metadata.thread_id` > `client_metadata.session_id` > 会话请求头 >
 * `prompt_cache_key`。请求体里的显式稳定 ID 是 OpenAI/Codex 的契约；会话头是客户端对
 * 本次会话的明确声明；`prompt_cache_key` 只是缓存提示，排在最后。
 * @param request - 含 body 与 headers 的请求
 * @returns `s:<uuid>`；没有可识别会话标识时为 undefined
 */
export function resolveRequestSessionGroupKey(request: {
	readonly body?: unknown;
	readonly headers?: Record<string, unknown> | undefined;
}): string | undefined {
	const requestBody = isRecord(request.body) ? request.body : undefined;
	if (hasClaudeCodeUserId(requestBody)) {
		return undefined;
	}
	const headers = request.headers ?? {};
	const clientMetadata = isRecord(requestBody?.client_metadata) ? requestBody.client_metadata : undefined;
	const candidates: unknown[] = [
		clientMetadata?.thread_id,
		clientMetadata?.session_id,
		...SESSION_ID_HEADERS.map((name) => readSessionIdHeader(headers, name)),
		requestBody?.prompt_cache_key,
	];
	for (const candidate of candidates) {
		const sessionUuid = normalizeSessionUuid(candidate);
		if (sessionUuid !== null) {
			return `s:${sessionUuid}`;
		}
	}
	return undefined;
}
