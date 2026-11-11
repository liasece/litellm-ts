/**
 * 会话身份解析：把各客户端声明的稳定任务 ID 归一成持久化分组键 `s:<uuid>`。
 *
 * 同一件事在不同客户端有不同写法，只认裸 UUID 会漏掉它们，于是 SpendLog 退回请求级
 * `session_id`，每个请求各自成组：
 * - OpenAI Responses/Codex 用 `client_metadata.thread_id` / `client_metadata.session_id`；
 * - DeepSeek Harness 用 `session_id` 请求头，并把它同时写进 `prompt_cache_key`；
 * - 部分客户端给稳定 UUID 加 `session-` 前缀，如 `session-2e24587f-…`；
 * - Claude Code 用 `metadata.user_id` 里的 `user_…_account_…_session_…` 整体分组，落 `c:` 键；
 * - 也有客户端把 `{"session_id":"<uuid>"}` 塞进同一个 `user_id`。
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
 * 读取客户端声明的 spend 用户标识。
 *
 * 生产上 Claude Code 直接写在 `metadata.user_id`，也有客户端嵌一层
 * `metadata.spend_logs_metadata.user_id`（Python 兼容形状），两处都认。
 * @param requestBody - 请求体
 */
function readDeclaredSpendUserId(requestBody: Record<string, unknown> | undefined): unknown {
	const metadata = requestBody?.metadata;
	if (!isRecord(metadata)) {
		return undefined;
	}
	if (metadata.user_id !== undefined) {
		return metadata.user_id;
	}
	const nested = metadata.spend_logs_metadata;
	return isRecord(nested) ? nested.user_id : undefined;
}

/**
 * Claude Code 的 `user_…_account_…_session_…` 整体分组；返回规范键里的 user_id 部分。
 * @param value - 客户端声明的用户标识
 */
export function matchClaudeCodeSessionUserId(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return CLAUDE_CODE_USER_ID_PATTERN.test(trimmed) ? trimmed : null;
}

/** 部分客户端把会话信息塞进 user_id，形如 `{"session_id":"<uuid>"}`。 */
const EMBEDDED_SESSION_ID_PATTERN =
	/"session_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i;

/**
 * `user_id` 里内嵌的会话 UUID。
 * @param value - 客户端声明的用户标识
 */
export function matchEmbeddedSessionId(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const matched = EMBEDDED_SESSION_ID_PATTERN.exec(value)?.[1];
	return matched === undefined ? null : matched.toLowerCase();
}

/**
 * 解析一次请求的规范会话分组键。
 *
 * Claude Code 优先：它的整段对话由 `user_…_account_…_session_…` 决定，即使同一个请求还带了
 * 会话头也不能把会话拆开。其余按 `client_metadata.thread_id` > `client_metadata.session_id` >
 * 会话请求头 > `prompt_cache_key`，最后才是 `user_id` 里内嵌的会话 UUID。
 *
 * 返回形状（`c:<user_id>` / `s:<uuid>`）与 `litellm_session_group_key` 的规范分支一致，
 * 因此在途行与结束后落库的行得到同一个分组键。
 * @param request - 含 body 与 headers 的请求
 * @returns `c:<user_id>` 或 `s:<uuid>`；没有可识别会话标识时为 undefined
 */
export function resolveRequestSessionGroupKey(request: {
	readonly body?: unknown;
	readonly headers?: Record<string, unknown> | undefined;
}): string | undefined {
	const requestBody = isRecord(request.body) ? request.body : undefined;
	const declaredUserId = readDeclaredSpendUserId(requestBody);
	const claudeCodeUserId = matchClaudeCodeSessionUserId(declaredUserId);
	if (claudeCodeUserId !== null) {
		return `c:${claudeCodeUserId}`;
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
	const embeddedSessionId = matchEmbeddedSessionId(declaredUserId);
	return embeddedSessionId === null ? undefined : `s:${embeddedSessionId}`;
}
