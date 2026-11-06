/**
 * SpendLogs 列表与 Session 读取共用的列表达式。
 *
 * 这些表达式带有历史兼容语义（失败调用的模型回退、缺省耗时的计算、非对象 metadata
 * 不做不安全 cast），每处读取都必须得到同一个值。集中在这里，Session 时间线的新读取
 * 路径与 Logs 列表不会因为各写一份 SQL 而在同一条日志上显示不同的模型或状态。
 */

import { sql } from "drizzle-orm";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";

/**
 * 失败调用且未记录 model_id 时，按上游请求里的真实模型归属（Python 兼容行为）。
 */
export function spendLogExecutionModelSql() {
	return sql<string>`CASE
		WHEN ${liteLLM_SpendLogs.status} = 'failure'
			AND COALESCE(${liteLLM_SpendLogs.model_id}, '') = ''
			AND ${liteLLM_SpendLogs.model} = ${liteLLM_SpendLogs.model_group}
			AND jsonb_typeof(${liteLLM_SpendLogs.proxy_server_request}#>'{upstream_request,body,model}') = 'string'
		THEN COALESCE(NULLIF(${liteLLM_SpendLogs.proxy_server_request}#>>'{upstream_request,body,model}', ''), ${liteLLM_SpendLogs.model})
		ELSE ${liteLLM_SpendLogs.model}
	END`;
}

/** Python UI logs duration expression: DB NULL fallback to endTime-startTime in milliseconds. */
export function spendLogDurationSql() {
	return sql<number>`COALESCE(${liteLLM_SpendLogs.request_duration_ms}, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (${liteLLM_SpendLogs.endTime} - ${liteLLM_SpendLogs.startTime})) * 1000))::int)`;
}

/** metadata 仅在原生 JSON object 时参与通用字段过滤；历史 string 不做不安全 cast。 */
export function spendLogMetadataJsonSql() {
	return sql`CASE WHEN jsonb_typeof(${liteLLM_SpendLogs.metadata}) = 'object' THEN ${liteLLM_SpendLogs.metadata} ELSE '{}'::jsonb END`;
}
