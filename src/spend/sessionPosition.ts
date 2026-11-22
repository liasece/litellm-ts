/**
 * Session 读取位置（(startTime, request_id) 复合键）。
 *
 * 分页游标与时间线的一致性快照都用同一个位置表达：先在读取开始时固定一个上界，
 * 再按复合键向后翻页或追加，避免读取过程中新写入的行让结果重复或漏掉。编码后的位置
 * 以 base64url 出现在 HTTP 响应里，因此这里只使用 `startTime`/`requestId` 两个字段。
 *
 * 编解码是纯函数；三个行值比较条件由 `SpendReportingRepository` 提供——比较必须引用
 * 表列，而表列只允许出现在仓储里，调用方拿到片段后直接拼进自己的查询。
 */

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
