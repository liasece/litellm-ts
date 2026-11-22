/**
 * Session 时间线读取仓储 —— 时间线所需的 SpendLogs 投影、在途行与图片回填查询。
 *
 * 时间线的读模型与列表/报表不同：它按会话分组键只读一段，且要为「内容寻址的块引用」按
 * 选中序号回表取正文。这些表达式（消息体积、上游请求体、块 join）与业务装配强绑定，
 * 却全是 SQL；放在这里可以让装配层只关心窗口切分与去重，不再直接碰表。
 *
 * 两个实现细节决定这里的查询形状：
 *   - 窗口候选行只读 `pg_column_size`，不读内容，因此切窗口本身很便宜；
 *   - payload 只按选中序号取，长会话不会为了读一段尾巴把整段历史 detoast 出来。
 */

import { and, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import { BaseRepository } from "../core/db/BaseRepository";
import type { DrizzleDb } from "../core/db/Database";
import { liteLLM_ActiveRequests } from "../db/schema/activeRequests";
import { liteLLM_SpendLogBlocks } from "../db/schema/spendLogBlocks";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import {
	SPEND_LOG_INPUT_REF_KEY,
	SPEND_LOG_MESSAGE_REF_KEY,
	SPEND_LOG_REF_BYTES_KEY,
	SPEND_LOG_REF_MISSING_KEY,
	SPEND_LOG_SAME_AS_MESSAGES,
	SPEND_LOG_SYSTEM_COUNT_KEY,
	SPEND_LOG_SYSTEM_FIRST_KEY,
	SPEND_LOG_SYSTEM_REF_KEY,
	SPEND_LOG_SYSTEM_SECOND_KEY,
	SPEND_LOG_TOOLS_COUNT_KEY,
	SPEND_LOG_TOOLS_FIRST_KEY,
} from "../spend/SpendLogBlocks";
import { spendLogExecutionModelSql } from "../spend/spendLogProjections";
import { spendLogStatusSql } from "../spend/spendLogStatus";
import { CallType } from "../types/spend";
import { singletonFor } from "./internal/registry";

/**
 * 取得与数据库连接绑定的时间线仓储。
 * @param db - Drizzle 数据库实例
 */
export const sessionTimelineRepositoryFor = singletonFor((db: DrizzleDb) => new SessionTimelineRepository(db));

/** 图片回填查询的入参；只在可见范围内按 key + 时间窗 + 提示词精确匹配。 */
export interface SessionImageLookupQuery {
	/** 已鉴权的可见性条件 */
	readonly visibilityClause: SQL;
	/** 发起该次图片生成的密钥 */
	readonly apiKey: string;
	/** 时间窗下界 */
	readonly from: Date;
	/** 时间窗上界 */
	readonly to: Date;
	/** 已有请求里的提示词 */
	readonly prompt: string;
}

/** 图片回填候选行；`response` 可能被冷存储替换。 */
export interface SessionImageRow {
	/** 命中请求的 ID */
	readonly requestId: string;
	/** 响应正文；冷存储命中时已被替换 */
	readonly response: unknown;
}

/**
 * Session 时间线读取仓储。
 *
 * 只读，不缓存：时间线要反映「刚刚结算」的请求，缓存会让实时刷新看到过期内容。
 */
export class SessionTimelineRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	// ────────────────────────── 条件 ──────────────────────────

	/**
	 * 会话内在途请求的读取条件。
	 *
	 * ActiveRequests 没有 session_group_key 列，注册时写入的 `metadata.session_group_key` 是唯一
	 * 分组依据；过期行由心跳判定失效，与列表接口同样过滤。
	 * @param groupKey - 规范会话键
	 * @param activeVisibilityClause - 在途行可见性条件
	 * @returns 组合后的条件
	 */
	sessionActiveClause(groupKey: string, activeVisibilityClause: SQL): SQL {
		return and(
			eq(liteLLM_ActiveRequests.status, "in_progress"),
			gt(liteLLM_ActiveRequests.expires_at, new Date()),
			sql`${liteLLM_ActiveRequests.metadata}->>'session_group_key' = ${groupKey}`,
			activeVisibilityClause,
		) as SQL;
	}

	/**
	 * 按请求 ID 集合过滤已落库日志（窗口内的清单/payload 回表）。
	 * @param requestIds - 请求 ID
	 * @returns `request_id IN (...)`
	 */
	spendLogRequestIdsClause(requestIds: readonly string[]): SQL {
		return inArray(liteLLM_SpendLogs.request_id, [...requestIds]);
	}

	/**
	 * 按单个请求 ID 过滤已落库日志（游标基线读取）。
	 * @param requestId - 请求 ID
	 * @returns `request_id = $1`
	 */
	spendLogRequestIdClause(requestId: string): SQL {
		return eq(liteLLM_SpendLogs.request_id, requestId);
	}

	/**
	 * 用 JSON 对象的键匹配请求 ID。
	 *
	 * 未切窗口时（增量读取）候选 ID 可能覆盖整段会话，`?` 运算符让数据库先按行过滤，
	 * 不必把 ID 列表展开成上千个 OR。
	 * @param requestIdsJson - request_id → 选中序号数组的 JSON
	 * @returns `$1::jsonb ? request_id`
	 */
	spendLogSelectionKeyedByRequestIdClause(requestIdsJson: string): SQL {
		return sql`${requestIdsJson}::jsonb ? ${liteLLM_SpendLogs.request_id}`;
	}

	// ────────────────────────── 查询 ──────────────────────────

	/**
	 * 读取窗口候选行（只含位置与压缩后的消息体积）。
	 * @template T - 调用方的行类型
	 * @param rangeClause - 已限制的读取范围
	 * @param order - 按位置的正/倒序；`null` 表示不排序（游标基线按主键单行回表）
	 * @param limit - 最多读取多少行
	 * @returns 候选行
	 */
	async listWindowScanRows<T>(rangeClause: SQL, order: "asc" | "desc" | null, limit: number): Promise<T[]> {
		const base = this._db.select(this._windowScanSelection()).from(liteLLM_SpendLogs).where(rangeClause);
		if (order === null) {
			return (await base.limit(limit)) as T[];
		}
		const ordering =
			order === "desc"
				? sql`${liteLLM_SpendLogs.startTime} DESC, ${liteLLM_SpendLogs.request_id} DESC`
				: sql`${liteLLM_SpendLogs.startTime} ASC, ${liteLLM_SpendLogs.request_id} ASC`;
		return (await base.orderBy(ordering).limit(limit)) as T[];
	}

	/**
	 * 读取时间线清单行。
	 *
	 * 数组 payload 只暴露便宜的长度，真正的正文由 `listPayloadRows` 按选中序号取；
	 * 非数组的历史行仍走兜底路径。
	 * @template T - 调用方的行类型
	 * @param rangeClause - 已限制的读取范围
	 * @param order - 需要按位置排序时的方向；`null` 表示不排序（按请求 ID 回表）
	 * @param requestIds - 需要限定的请求 ID；缺省表示整个范围
	 * @param limit - 行数上限；缺省表示不限（按请求 ID 回表）
	 * @returns 清单行
	 */
	async listDescriptorRows<T>(rangeClause: SQL, order: "asc" | null, requestIds?: readonly string[], limit?: number): Promise<T[]> {
		const clause = requestIds === undefined ? rangeClause : (and(rangeClause, this.spendLogRequestIdsClause(requestIds)) as SQL);
		const scoped = this._db.select(this._descriptorSelection()).from(liteLLM_SpendLogs).where(clause);
		const ordered =
			order === null ? scoped : scoped.orderBy(sql`${liteLLM_SpendLogs.startTime} ASC, ${liteLLM_SpendLogs.request_id} ASC`);
		return (await (limit === undefined ? ordered : ordered.limit(limit))) as T[];
	}

	/**
	 * 读取 Claude Code 辅助调用的分类字段。
	 *
	 * 只对清单里消息数 ≤ 2 的行执行，正常对话请求不会为分类反复解压累积快照。
	 * @template T - 调用方的行类型
	 * @param clause - 读取范围（已限定候选请求 ID）
	 * @returns 分类行
	 */
	async listAuxiliaryRows<T>(clause: SQL): Promise<T[]> {
		return (await this._db.select(this._auxiliarySelection()).from(liteLLM_SpendLogs).where(clause)) as T[];
	}

	/**
	 * 读取选中序号对应的请求正文。
	 * @template T - 调用方的行类型
	 * @param clause - 读取范围（已限定候选请求 ID）
	 * @param selectedIndicesJson - request_id → 选中序号数组的 JSON
	 * @returns 每行的 request_payload
	 */
	async listPayloadRows<T>(clause: SQL, selectedIndicesJson: string): Promise<T[]> {
		return (await this._db.select(this._payloadSelection(selectedIndicesJson)).from(liteLLM_SpendLogs).where(clause)) as T[];
	}

	/**
	 * 读取会话内仍在进行中的请求。
	 * @template T - 调用方的行类型
	 * @param activeClause - 在途行条件
	 * @returns 按位置升序的在途行
	 */
	async listActiveRequestRows<T>(activeClause: SQL): Promise<T[]> {
		return (await this._db
			.select({
				request_id: liteLLM_ActiveRequests.request_id,
				call_type: liteLLM_ActiveRequests.call_type,
				api_key: liteLLM_ActiveRequests.api_key,
				startTime: liteLLM_ActiveRequests.startTime,
				model: liteLLM_ActiveRequests.model,
				metadata: liteLLM_ActiveRequests.metadata,
				proxy_server_request: liteLLM_ActiveRequests.proxy_server_request,
				completion_start_time: liteLLM_ActiveRequests.completion_start_time,
				updated_at: liteLLM_ActiveRequests.updated_at,
			})
			.from(liteLLM_ActiveRequests)
			.where(activeClause)
			.orderBy(sql`${liteLLM_ActiveRequests.startTime} ASC, ${liteLLM_ActiveRequests.request_id} ASC`)) as T[];
	}

	/**
	 * 读取进行中行的变化指纹原始值：数量 + 最近更新时间。
	 *
	 * checkpoint、心跳续租与一次性字段补写都会推进 `updated_at`，任何内容变化都会让指纹改变；
	 * 指纹未变时可以跳过整批重读，空转刷新只花一次计数查询。
	 * @param activeClause - 在途行条件
	 * @returns 行数与最近更新时间
	 */
	async readActiveRequestRevision(activeClause: SQL): Promise<{ readonly count: number; readonly latest: string | null }> {
		const rows = await this._db
			.select({
				count: sql<number>`COUNT(*)`,
				latest: sql<string | null>`MAX(${liteLLM_ActiveRequests.updated_at})`,
			})
			.from(liteLLM_ActiveRequests)
			.where(activeClause);
		return { count: Number(rows.at(0)?.count ?? 0), latest: rows.at(0)?.latest ?? null };
	}

	/**
	 * 按 key + 时间窗 + 提示词查找唯一一次图片生成。
	 *
	 * 命中多行或零行都视为不可回填：同一提示词在同一窗口内出现两次时无法判断哪一条对应
	 * 这次请求，宁可让时间线继续显示占位。
	 * @param query - 查询条件
	 * @returns 候选行（0、1 或 2 条）
	 */
	async listImageCandidates(query: SessionImageLookupQuery): Promise<SessionImageRow[]> {
		return (await this._db
			.select({ requestId: liteLLM_SpendLogs.request_id, response: liteLLM_SpendLogs.response })
			.from(liteLLM_SpendLogs)
			.where(
				and(
					query.visibilityClause,
					eq(liteLLM_SpendLogs.api_key, query.apiKey),
					inArray(liteLLM_SpendLogs.call_type, [CallType.ImageGeneration, CallType.AImageGeneration]),
					sql`${liteLLM_SpendLogs.startTime} >= ${query.from}`,
					sql`${liteLLM_SpendLogs.endTime} <= ${query.to}`,
					sql`COALESCE(${liteLLM_SpendLogs.proxy_server_request}#>>'{body,prompt}',
						${liteLLM_SpendLogs.messages}#>>'{}') = ${query.prompt}`,
				),
			)
			.limit(2)) as SessionImageRow[];
	}

	// ────────────────────────── 投影 ──────────────────────────

	/**
	 * 单行消息体积（用于窗口字节预算），不读内容。
	 *
	 * 内容寻址去重后列里只剩引用，`pg_column_size` 反映的是引用数组的大小而不是正文体积；
	 * 写入侧把逻辑字节数记在 `_litellm_ref_bytes` 上，这里直接取用，避免为预算去 join 块表。
	 */
	private _messagesBytesSql() {
		const messages = liteLLM_SpendLogs.messages;
		return sql<number>`
		CASE
			WHEN jsonb_typeof(${messages} -> ${SPEND_LOG_MESSAGE_REF_KEY}) = 'array'
				THEN COALESCE((${messages} ->> ${SPEND_LOG_REF_BYTES_KEY})::numeric, 0)
			ELSE COALESCE(pg_column_size(${messages}), 0)
		END
	`;
	}

	/** 窗口扫描只取判断窗口边界需要的字段。 */
	private _windowScanSelection() {
		return {
			request_id: liteLLM_SpendLogs.request_id,
			startTime: liteLLM_SpendLogs.startTime,
			messages_bytes: this._messagesBytesSql(),
		};
	}

	/**
	 * 清单投影。数组 payload 只取便宜的长度，正文留给 payload 查询按高水位选中的序号取。
	 */
	private _descriptorSelection() {
		const messages = liteLLM_SpendLogs.messages;
		const metadata = liteLLM_SpendLogs.metadata;
		return {
			request_id: liteLLM_SpendLogs.request_id,
			call_type: liteLLM_SpendLogs.call_type,
			api_key: liteLLM_SpendLogs.api_key,
			spend: liteLLM_SpendLogs.spend,
			total_tokens: liteLLM_SpendLogs.total_tokens,
			startTime: liteLLM_SpendLogs.startTime,
			endTime: liteLLM_SpendLogs.endTime,
			model: spendLogExecutionModelSql(),
			status: spendLogStatusSql(liteLLM_SpendLogs.status, liteLLM_SpendLogs.metadata),
			metadata_status: spendLogStatusSql(
				sql<string | null>`CASE WHEN jsonb_typeof(${metadata}) = 'object' THEN ${metadata}->>'status' ELSE NULL END`,
				liteLLM_SpendLogs.metadata,
			),
			key_alias: sql<string | null>`
			CASE WHEN jsonb_typeof(${metadata}) = 'object' THEN ${metadata}->>'user_api_key_alias' ELSE NULL END
		`,
			error_information: sql<unknown | null>`
			CASE WHEN jsonb_typeof(${metadata}) = 'object' THEN ${metadata}->'error_information' ELSE NULL END
		`,
			internal_call_type: sql<string | null>`
			CASE WHEN jsonb_typeof(${metadata}) = 'object' THEN ${metadata}->>'internal_call_type' ELSE NULL END
		`,
			builtin_capability: sql<string | null>`
			CASE WHEN jsonb_typeof(${metadata}) = 'object' THEN ${metadata}->>'builtin_capability' ELSE NULL END
		`,
			parent_request_id: sql<string | null>`
			CASE WHEN jsonb_typeof(${metadata}) = 'object' THEN ${metadata}->>'parent_request_id' ELSE NULL END
		`,
			request_payload: sql<unknown>`NULL`,
			request_message_count: sql<number | null>`
			CASE
				WHEN jsonb_typeof(${messages}) = 'array' THEN jsonb_array_length(${messages})
				WHEN jsonb_typeof(${messages} -> ${SPEND_LOG_MESSAGE_REF_KEY}) = 'array'
					THEN jsonb_array_length(${messages} -> ${SPEND_LOG_MESSAGE_REF_KEY})
				ELSE NULL
			END
		`,
			upstream_message_count: this._upstreamMessageCountSql(),
			response_payload: liteLLM_SpendLogs.response,
			response_payload_available: sql<boolean>`
			${liteLLM_SpendLogs.response} IS NOT NULL
			AND ${liteLLM_SpendLogs.response} <> 'null'::jsonb
			AND ${liteLLM_SpendLogs.response} <> '{}'::jsonb
			AND ${liteLLM_SpendLogs.response} <> '[]'::jsonb
		`,
		};
	}

	/**
	 * 最终上游请求体：传输层记录的最后一次真实交换。
	 *
	 * 上游请求只在开启 `store_upstream_logs_in_spend_logs` 时落库；未记录时所有读取都回退到
	 * 客户端请求快照，时间线仍能工作，只是看不到模型实际收到的内部处理结果。
	 */
	private _upstreamBodySql(): SQL {
		return sql`${liteLLM_SpendLogs.proxy_server_request}->'upstream_request'->'body'`;
	}

	/**
	 * 上游请求里可渲染的消息条数。
	 *
	 * 与下游 `messages` 列一样，数组可能内联、已编码成引用列表，或在行里写成 `"$messages"`
	 * 表示与列根引用相同。没有上游消息时返回 null，调用方据此回退到下游计数。
	 */
	private _upstreamMessageCountSql(): SQL<number | null> {
		const messages = liteLLM_SpendLogs.messages;
		const body = this._upstreamBodySql();
		return sql<number | null>`
		CASE
			WHEN jsonb_typeof(${body} -> 'messages') = 'array' THEN jsonb_array_length(${body} -> 'messages')
			WHEN jsonb_typeof(${body} -> ${SPEND_LOG_MESSAGE_REF_KEY}) = 'array'
				THEN jsonb_array_length(${body} -> ${SPEND_LOG_MESSAGE_REF_KEY})
			WHEN ${body} ->> ${SPEND_LOG_MESSAGE_REF_KEY} = ${SPEND_LOG_SAME_AS_MESSAGES} THEN
				CASE
					WHEN jsonb_typeof(${messages}) = 'array' THEN jsonb_array_length(${messages})
					WHEN jsonb_typeof(${messages} -> ${SPEND_LOG_MESSAGE_REF_KEY}) = 'array'
						THEN jsonb_array_length(${messages} -> ${SPEND_LOG_MESSAGE_REF_KEY})
					ELSE NULL
				END
			WHEN jsonb_typeof(${body} -> 'input') = 'array' THEN jsonb_array_length(${body} -> 'input')
			WHEN jsonb_typeof(${body} -> ${SPEND_LOG_INPUT_REF_KEY}) = 'array'
				THEN jsonb_array_length(${body} -> ${SPEND_LOG_INPUT_REF_KEY})
			ELSE NULL
		END
	`;
	}

	/** 是否以最终上游请求作为请求消息来源；与计数 SQL 共用同一判定。 */
	private _usesUpstreamSql(): SQL {
		return sql`COALESCE(${this._upstreamMessageCountSql()}, 0) > 0`;
	}

	/**
	 * 从消息数组或块引用列表中取出时间线选中的序号。
	 *
	 * 内联数组直接按序号过滤；引用列表只 join 选中的块，避免长会话为读一段尾巴把整段历史
	 * 都取出来。`"$messages"` 引用与下游列相同，按列根引用展开。
	 * @param arrayExpr - 内联消息数组表达式
	 * @param refsExpr - 块引用列表表达式
	 * @param selectedIndicesJson - request_id → 选中序号数组的 JSON
	 */
	private _selectedMessagesSql(arrayExpr: SQL, refsExpr: SQL, selectedIndicesJson: string): SQL {
		const requestId = liteLLM_SpendLogs.request_id;
		const blocks = liteLLM_SpendLogBlocks;
		// 引用列表也可能是 `"$messages"` 字符串。jsonb 与 text 参数直接比较会被 PostgreSQL
		// 解析成 `text::jsonb`，把哨兵值当成 JSON 文本；先用 `#>> '{}'` 取出标量文本再比较。
		const refs = sql`CASE
		WHEN (${refsExpr}) #>> '{}' = ${SPEND_LOG_SAME_AS_MESSAGES}
			THEN ${liteLLM_SpendLogs.messages} -> ${SPEND_LOG_MESSAGE_REF_KEY}
		ELSE ${refsExpr}
	END`;
		// 规划器只取尾部一小段或整段消息。按选中序号反向取数组元素 / 块引用，
		// 避免把整段历史 refs 展开后再逐项过滤后 join 所有块；长会话下这是 payload 阶段的主要浪费。
		const selectedIndexes = sql`(
		SELECT (entry.value #>> '{}')::int AS idx
		FROM jsonb_array_elements(${selectedIndicesJson}::jsonb -> ${requestId}) WITH ORDINALITY AS entry(value, ordinality)
	) AS selected_index`;
		return sql`
		CASE
			WHEN jsonb_typeof(${arrayExpr}) = 'array' THEN COALESCE((
				SELECT jsonb_agg(item.value ORDER BY selected_index.idx)
				FROM ${selectedIndexes}
				CROSS JOIN LATERAL (SELECT ${arrayExpr} -> selected_index.idx AS value) AS item
				WHERE item.value IS NOT NULL
			), '[]'::jsonb)
			WHEN jsonb_typeof(${refs}) = 'array' THEN COALESCE((
				SELECT jsonb_agg(
					COALESCE(${blocks.payload}, jsonb_build_object(${SPEND_LOG_REF_MISSING_KEY}::text, ref.ref_id))
					ORDER BY selected_index.idx
				)
				FROM ${selectedIndexes}
				CROSS JOIN LATERAL (SELECT ${refs} ->> selected_index.idx AS ref_id) AS ref
				LEFT JOIN ${blocks} ON ${blocks.blockId} = ref.ref_id
				WHERE ref.ref_id IS NOT NULL
			), '[]'::jsonb)
			ELSE NULL
		END
	`;
	}

	/**
	 * 上游请求的 system 段：可能是内联数组，也可能是整数组块引用。
	 * @returns 无法还原时返回 null，由解析器忽略
	 */
	private _upstreamSystemSql(): SQL {
		const body = this._upstreamBodySql();
		const blocks = liteLLM_SpendLogBlocks;
		return sql`
		CASE
			WHEN jsonb_typeof(${body} -> 'system') IN ('array', 'string', 'object')
				THEN ${body} -> 'system'
			WHEN jsonb_typeof(${body} -> ${SPEND_LOG_SYSTEM_REF_KEY}) = 'string' THEN COALESCE((
				SELECT ${blocks.payload}
				FROM ${blocks}
				WHERE ${blocks.blockId} = ${body} ->> ${SPEND_LOG_SYSTEM_REF_KEY}
			), jsonb_build_array(jsonb_build_object(
				${SPEND_LOG_REF_MISSING_KEY}::text,
				${body} ->> ${SPEND_LOG_SYSTEM_REF_KEY}
			)))
			ELSE NULL
		END
	`;
	}

	/**
	 * Claude Code 辅助调用的分类字段。
	 *
	 * 前缀匹配容忍 Claude Code 版本间的提示词尾部差异，256 字符上限则避免大段 system
	 * 提示词只为分类进入批量结果。
	 */
	private _auxiliarySelection() {
		const proxy = liteLLM_SpendLogs.proxy_server_request;
		const messages = liteLLM_SpendLogs.messages;
		return {
			request_id: liteLLM_SpendLogs.request_id,
			request_message_count: sql<number>`
			CASE
				WHEN jsonb_typeof(${messages}) = 'array' THEN jsonb_array_length(${messages})
				WHEN jsonb_typeof(${proxy}#>'{body,messages}') = 'array'
					THEN jsonb_array_length(${proxy}#>'{body,messages}')
				ELSE 0
			END
		`,
			request_client: sql<string | null>`
			CASE
				WHEN ${proxy}#>>'{headers,x-app}' = 'cli'
					AND ${proxy}#>>'{headers,user-agent}' LIKE 'claude-cli/%'
				THEN 'claude_code'
				ELSE NULL
			END
		`,
			request_system_count: sql<number>`
			CASE
				WHEN jsonb_typeof(${proxy}#>'{body,system}') = 'array'
				THEN jsonb_array_length(${proxy}#>'{body,system}')
				WHEN jsonb_typeof(${proxy}#>ARRAY['body', ${SPEND_LOG_SYSTEM_COUNT_KEY}]) = 'number'
				THEN (${proxy}#>>ARRAY['body', ${SPEND_LOG_SYSTEM_COUNT_KEY}])::int
				ELSE 0
			END
		`,
			request_tool_count: sql<number>`
			CASE
				WHEN jsonb_typeof(${proxy}#>'{body,tools}') = 'array'
				THEN jsonb_array_length(${proxy}#>'{body,tools}')
				WHEN jsonb_typeof(${proxy}#>ARRAY['body', ${SPEND_LOG_TOOLS_COUNT_KEY}]) = 'number'
				THEN (${proxy}#>>ARRAY['body', ${SPEND_LOG_TOOLS_COUNT_KEY}])::int
				ELSE 0
			END
		`,
			request_first_tool_name: sql<string | null>`
			COALESCE(
				${proxy}#>>'{body,tools,0,name}',
				${proxy}#>>ARRAY['body', ${SPEND_LOG_TOOLS_FIRST_KEY}]
			)
		`,
			request_first_system_prompt: sql<string | null>`
			COALESCE(
				LEFT(
					COALESCE(
						${proxy}#>>'{body,system,0,text}',
						${proxy}#>>'{body,system,0}'
					),
					256
				),
				${proxy}#>>ARRAY['body', ${SPEND_LOG_SYSTEM_FIRST_KEY}]
			)
		`,
			request_second_system_prompt: sql<string | null>`
			COALESCE(
				LEFT(
					COALESCE(
						${proxy}#>>'{body,system,1,text}',
						${proxy}#>>'{body,system,1}'
					),
					256
				),
				${proxy}#>>ARRAY['body', ${SPEND_LOG_SYSTEM_SECOND_KEY}]
			)
		`,
			request_first_message_role: sql<string | null>`
			COALESCE(
				${messages}#>>'{0,role}',
				${proxy}#>>'{body,messages,0,role}'
			)
		`,
			request_second_message_role: sql<string | null>`
			COALESCE(
				${messages}#>>'{1,role}',
				${proxy}#>>'{body,messages,1,role}'
			)
		`,
			request_first_message_text: sql<string | null>`
			LEFT(COALESCE(
				${messages}#>>'{0,content,0,text}',
				${messages}#>>'{0,content}',
				${proxy}#>>'{body,messages,0,content,0,text}',
				${proxy}#>>'{body,messages,0,content}'
			), 256)
		`,
			request_second_message_text: sql<string | null>`
			LEFT(COALESCE(
				${messages}#>>'{1,content,0,text}',
				${messages}#>>'{1,content}',
				${proxy}#>>'{body,messages,1,content,0,text}',
				${proxy}#>>'{body,messages,1,content}'
			), 256)
		`,
		};
	}

	/**
	 * 只取清单选中序号对应的正文。
	 *
	 * 请求侧优先返回最终上游请求的 message：内部处理（能力注入、协议转换、私有工具循环）
	 * 会改写模型实际收到的输入，客户端快照看不到这些变化。响应侧仍只取下游 `response`，
	 * 两者共同组成用户在时间线里看到的对话。上游未记录或没有消息时保持原有下游读取路径。
	 * @param selectedIndicesJson - request_id → 选中序号数组的 JSON
	 */
	private _payloadSelection(selectedIndicesJson: string) {
		const proxy = liteLLM_SpendLogs.proxy_server_request;
		const messages = liteLLM_SpendLogs.messages;
		const upstreamBody = this._upstreamBodySql();
		const upstreamMessages = this._selectedMessagesSql(
			sql`${upstreamBody} -> 'messages'`,
			sql`${upstreamBody} -> ${SPEND_LOG_MESSAGE_REF_KEY}`,
			selectedIndicesJson,
		);
		const upstreamInput = this._selectedMessagesSql(
			sql`${upstreamBody} -> 'input'`,
			sql`${upstreamBody} -> ${SPEND_LOG_INPUT_REF_KEY}`,
			selectedIndicesJson,
		);
		const fallbackPayload = sql<unknown>`
		CASE
			WHEN jsonb_typeof(${proxy}) = 'object' AND ${proxy}->'body' IS NOT NULL THEN ${proxy}->'body'
			ELSE ${proxy}
		END
	`;
		return {
			request_id: liteLLM_SpendLogs.request_id,
			request_payload: sql<unknown>`
			CASE
				WHEN ${this._usesUpstreamSql()} THEN jsonb_build_object(
					'messages', NULLIF(${upstreamMessages}, '[]'::jsonb),
					'input', ${upstreamInput},
					'system', ${this._upstreamSystemSql()},
					'instructions', ${upstreamBody} -> 'instructions'
				)
				WHEN jsonb_typeof(${messages}) = 'array' THEN COALESCE((
					SELECT jsonb_agg(timeline_item.value ORDER BY timeline_item.ordinality)
					FROM jsonb_array_elements(${messages}) WITH ORDINALITY AS timeline_item(value, ordinality)
					WHERE (${selectedIndicesJson}::jsonb -> ${liteLLM_SpendLogs.request_id})
						@> to_jsonb((timeline_item.ordinality - 1)::int)
				), '[]'::jsonb)
				-- 内容寻址去重后的行：只按选中的序号去块表取内容，引用数组本身只有几 KB，
				-- 不需要为了切一段尾巴把整段历史 detoast 出来。
				WHEN jsonb_typeof(${messages} -> ${SPEND_LOG_MESSAGE_REF_KEY}) = 'array' THEN COALESCE((
					SELECT jsonb_agg(
						COALESCE(${liteLLM_SpendLogBlocks.payload}, jsonb_build_object(${SPEND_LOG_REF_MISSING_KEY}::text, block_ref.value))
						ORDER BY block_ref.ordinality
					)
					FROM jsonb_array_elements_text(${messages} -> ${SPEND_LOG_MESSAGE_REF_KEY})
						WITH ORDINALITY AS block_ref(value, ordinality)
					LEFT JOIN ${liteLLM_SpendLogBlocks} ON ${liteLLM_SpendLogBlocks.blockId} = block_ref.value
					WHERE (${selectedIndicesJson}::jsonb -> ${liteLLM_SpendLogs.request_id})
						@> to_jsonb((block_ref.ordinality - 1)::int)
				), '[]'::jsonb)
				WHEN ${messages} IS NOT NULL
					AND ${messages} <> 'null'::jsonb
					AND ${messages} <> '{}'::jsonb
					AND ${messages} <> '[]'::jsonb
				THEN ${messages}
				WHEN jsonb_typeof(${fallbackPayload}) = 'array' THEN COALESCE((
					SELECT jsonb_agg(timeline_item.value ORDER BY timeline_item.ordinality)
					FROM jsonb_array_elements(${fallbackPayload}) WITH ORDINALITY AS timeline_item(value, ordinality)
					WHERE (${selectedIndicesJson}::jsonb -> ${liteLLM_SpendLogs.request_id})
						@> to_jsonb((timeline_item.ordinality - 1)::int)
				), '[]'::jsonb)
				ELSE ${fallbackPayload}
			END
		`,
		};
	}
}
