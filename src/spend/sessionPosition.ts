/**
 * Session 读取位置（(startTime, request_id) 复合键）。
 *
 * 分页游标与时间线的一致性快照都用同一个位置表达：先在读取开始时固定一个上界，
 * 再按复合键向后翻页或追加，避免读取过程中新写入的行让结果重复或漏掉。编码后的位置
 * 以 base64url 出现在 HTTP 响应里，因此这里只使用 `startTime`/`requestId` 两个字段。
 */

import { sql, type SQL } from "drizzle-orm";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { ApiError, HTTP_STATUS } from "../core/api/ApiError";

/** 一条日志在 `(startTime, request_id)` 上的位置。 */
export interface SessionPosition {
	/** 请求开始时间 */
	readonly startTime: Date;
	/** 请求 ID，用于时间相同时的稳定排序 */
	readonly requestId: string;
}

/**
 * 解析游标参数；缺省返回 null，格式非法抛 400。
 * @param value - base64url 编码的位置
 * @param parameterName - 出错时出现在消息里的参数名
 * @throws {ApiError} 位置无法解码或字段缺失时返回 400
 */
export function parseSessionPosition(value: unknown, parameterName: string): SessionPosition | null {
	if (value === undefined) {
		return null;
	}
	if (typeof value !== "string" || value.length === 0) {
		throw new ApiError(HTTP_STATUS.BAD_REQUEST, `invalid ${parameterName}`);
	}
	try {
		const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
		const startTime = typeof decoded.startTime === "string" ? new Date(decoded.startTime) : null;
		const requestId = decoded.requestId;
		if (!startTime || Number.isNaN(startTime.getTime()) || typeof requestId !== "string" || requestId.length === 0) {
			throw new Error("invalid position");
		}
		return { startTime: startTime, requestId: requestId };
	} catch {
		throw new ApiError(HTTP_STATUS.BAD_REQUEST, `invalid ${parameterName}`);
	}
}

/**
 * 把位置编码成响应里的游标。
 * @param position - 待编码位置
 */
export function encodeSessionPosition(position: SessionPosition): string {
	return Buffer.from(JSON.stringify({ startTime: position.startTime.toISOString(), requestId: position.requestId }), "utf8").toString(
		"base64url",
	);
}

/**
 * 从查询结果行里取出位置；行缺失或字段非法时返回 null。
 * @param row - 含时间与 request_id 的行
 * @param startTimeKey - 时间字段名
 * @param requestIdKey - 请求 ID 字段名
 */
export function sessionPositionFromRow(
	row: Record<string, unknown> | undefined,
	startTimeKey: string,
	requestIdKey: string,
): SessionPosition | null {
	if (!row) {
		return null;
	}
	const rawStartTime = row[startTimeKey];
	const startTime = rawStartTime instanceof Date ? rawStartTime : typeof rawStartTime === "string" ? new Date(rawStartTime) : null;
	const requestId = row[requestIdKey];
	if (!startTime || Number.isNaN(startTime.getTime()) || typeof requestId !== "string" || requestId.length === 0) {
		return null;
	}
	return { startTime: startTime, requestId: requestId };
}

/**
 * 位置上界条件：只读到快照位置为止。
 * @param snapshot - 读取开始时固定的上界
 */
export function sessionSnapshotClause(snapshot: SessionPosition): SQL {
	return sql`(${liteLLM_SpendLogs.startTime}, ${liteLLM_SpendLogs.request_id}) <= (${snapshot.startTime}, ${snapshot.requestId})`;
}

/**
 * 位置下界条件：只读游标之后的行。
 * @param cursor - 已读到的位置
 */
export function sessionCursorClause(cursor: SessionPosition): SQL {
	return sql`(${liteLLM_SpendLogs.startTime}, ${liteLLM_SpendLogs.request_id}) > (${cursor.startTime}, ${cursor.requestId})`;
}

/**
 * 位置上界条件：只读游标严格之前的行（向更早翻页）。
 * @param cursor - 当前窗口最早的位置
 */
export function sessionBeforeClause(cursor: SessionPosition): SQL {
	return sql`(${liteLLM_SpendLogs.startTime}, ${liteLLM_SpendLogs.request_id}) < (${cursor.startTime}, ${cursor.requestId})`;
}
