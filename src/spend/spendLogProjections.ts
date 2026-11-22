/**
 * SpendLogs 列表与 Session 读取共用的列表达式。
 *
 * 这些表达式带有历史兼容语义（失败调用的模型回退、缺省耗时的计算、非对象 metadata
 * 不做不安全 cast），每处读取都必须得到同一个值。集中在这里，Session 时间线的新读取
 * 路径与 Logs 列表不会因为各写一份 SQL 而在同一条日志上显示不同的模型或状态。
 *
 * 表达式本身定义在 SpendLogRepository：投影列属于「这张表怎么读」，仓储是唯一能引用
 * 表符号的地方；这里只保留稳定的函数名，供仍按列表达式组 query builder 的读取方使用。
 */

import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
	spendLogDurationProjection,
	spendLogExecutionModelProjection,
	spendLogListMetadataProjection,
	spendLogMetadataJsonProjection,
} from "../repositories/SpendLogRepository";

/**
 * 失败调用且未记录 model_id 时，按上游请求里的真实模型归属（Python 兼容行为）。
 * @returns 执行模型列的 SQL 表达式
 */
export function spendLogExecutionModelSql() {
	return spendLogExecutionModelProjection();
}

/**
 * Python UI logs duration expression: DB NULL fallback to endTime-startTime in milliseconds.
 * @returns 耗时列的 SQL 表达式
 */
export function spendLogDurationSql() {
	return spendLogDurationProjection();
}

/**
 * 请求是否要求流式：读 `proxy_server_request.body.stream`。
 *
 * 非流式成功响应只在整份结果就绪时写回下游，`completionStartTime` 与 `endTime` 因此只差
 * 毫秒。Dashboard 若照常按两个时间戳显示 TTFT，这个数字会与 Duration 重复，看起来像首字
 * 等了整段生成时间；两种「首帧」来源只能靠请求体区分，所以投影成显式标记，而不是让每个
 * 读取处自行比较时间戳。
 *
 * 客户端按 Anthropic/OpenAI 语义省略 `stream` 即非流式，因此 body 已落库但字段缺失要记
 * `false`；只有整个请求体没有记录（历史行、不写正文的调用类型）才返回 NULL，留给前端用
 * 时间戳兜底，避免把无法判断的行显示成非流式。
 * @param column - `proxy_server_request` 列（SpendLogs 与 ActiveRequests 同形状）
 * @returns 是否流式请求的 SQL 表达式
 */
export function streamRequestedSql(column: AnyPgColumn) {
	return sql<boolean | null>`CASE
		WHEN jsonb_typeof(${column} -> 'body') = 'object'
			THEN COALESCE((${column} -> 'body' ->> 'stream') = 'true', false)
		ELSE NULL
	END`;
}

/**
 * metadata 仅在原生 JSON object 时参与通用字段过滤；历史 string 不做不安全 cast。
 * @returns metadata jsonb 的 SQL 表达式
 */
export function spendLogMetadataJsonSql() {
	return spendLogMetadataJsonProjection();
}

/**
 * 列表投影里的 metadata：剥掉流式 checkpoint 载荷与已投影的用量副本。
 * @returns 精简 metadata 的 SQL 表达式
 */
export function spendLogListMetadataSql() {
	return spendLogListMetadataProjection();
}
