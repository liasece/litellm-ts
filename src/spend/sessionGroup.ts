/**
 * 会话分组（Session group）的表示与解析。
 *
 * Logs 列表、Session 计数、Session 分页、Session 时间线与其实时流都按同一个分组键读取
 * 数据。分组键有两种来源：客户端声明的稳定会话 UUID（`s:<uuid>`）与 Claude Code 的稳定
 * user ID（`c:user_...`）。入口参数解析与此处的键规范化集中在这一个模块，读取入口只需
 * 拿 `SessionGroupRef`，不再各自解析查询参数。
 */

import { ApiError, HTTP_STATUS } from "../core/api/ApiError";
import { CLAUDE_CODE_USER_ID_PATTERN } from "./sessionIdentity";

/** 会话分组类型：客户端声明的会话 UUID 或 Claude Code 的稳定用户 ID。 */
export type SessionGroupType = "claude_code_user_id" | "session_id";

/** 一次会话分组读取的目标。 */
export interface SessionGroupRef {
	/** 分组依据 */
	readonly type: SessionGroupType;
	/** 分组 ID（会话 UUID 或 Claude Code user ID） */
	readonly id: string;
}

/**
 * 解析 `/spend/logs/*` 的会话分组参数。
 *
 * 旧 `session_id` 只是输入别名：它能与显式分组参数二选一，不能混用，避免调用方以为
 * 传了 `session_id` 又覆盖了分组却没有察觉。
 * @param query - Express 查询参数
 * @throws {ApiError} 参数缺失、类型非法或与旧参数混用时返回 400
 */
export function parseSessionGroupQuery(query: Record<string, unknown>): SessionGroupRef {
	const legacySessionId = query.session_id;
	const sessionGroupType = query.session_group_type;
	const sessionGroupId = query.session_group_id;
	const hasLegacySessionId = legacySessionId !== undefined;
	const hasSessionGroupType = sessionGroupType !== undefined;
	const hasSessionGroupId = sessionGroupId !== undefined;
	if (hasLegacySessionId && (hasSessionGroupType || hasSessionGroupId)) {
		throw new ApiError(HTTP_STATUS.BAD_REQUEST, "session_id cannot be combined with session group parameters");
	}
	if (hasLegacySessionId) {
		if (typeof legacySessionId !== "string" || legacySessionId.length === 0) {
			throw new ApiError(HTTP_STATUS.BAD_REQUEST, "session_id is required");
		}
		return { type: "session_id", id: legacySessionId };
	}
	if (
		!hasSessionGroupType ||
		!hasSessionGroupId ||
		typeof sessionGroupType !== "string" ||
		typeof sessionGroupId !== "string" ||
		sessionGroupId.length === 0 ||
		(sessionGroupType !== "session_id" && sessionGroupType !== "claude_code_user_id")
	) {
		throw new ApiError(HTTP_STATUS.BAD_REQUEST, "valid session group parameters are required");
	}
	const normalizedGroupId = sessionGroupId.trim();
	if (sessionGroupType === "claude_code_user_id" && !CLAUDE_CODE_USER_ID_PATTERN.test(normalizedGroupId)) {
		throw new ApiError(HTTP_STATUS.BAD_REQUEST, "invalid Claude Code session group");
	}
	return { type: sessionGroupType, id: normalizedGroupId };
}

/**
 * 从一行日志的派生字段还原会话分组；字段缺失或非法时返回 null。
 * @param row - 带 `session_group_type` / `session_group_id` 的行
 */
export function readSessionGroup(row: Record<string, unknown>): SessionGroupRef | null {
	const type = row.session_group_type;
	const id = row.session_group_id;
	if ((type !== "session_id" && type !== "claude_code_user_id") || typeof id !== "string" || id.length === 0) {
		return null;
	}
	return { type: type, id: id };
}

/**
 * 数据库里的规范分组键（`litellm_session_group_key()` 的输出）。
 * @param group - 会话分组
 */
export function sessionGroupKey(group: SessionGroupRef): string {
	return `${group.type === "claude_code_user_id" ? "c" : "s"}:${group.id}`;
}

/**
 * 解析持久化的 `session_group_key` 文本。
 * @param value - 数据库字段或 metadata 里的规范键
 */
export function parsePersistedSessionGroupKey(value: unknown): SessionGroupRef | null {
	if (typeof value !== "string" || value.length < 3) {
		return null;
	}
	if (value.startsWith("c:")) {
		const id = value.slice(2);
		return CLAUDE_CODE_USER_ID_PATTERN.test(id) ? { type: "claude_code_user_id", id: id } : null;
	}
	if (value.startsWith("s:")) {
		const id = value.slice(2);
		return id.length > 0 ? { type: "session_id", id: id } : null;
	}
	return null;
}
