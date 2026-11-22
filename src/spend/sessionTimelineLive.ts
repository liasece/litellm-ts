/**
 * Session 时间线读取与实时装配的共享实现。
 *
 * 本模块把「已落库行 + 进行中请求」装配成一份时间线，HTTP `/spend/logs/session/timeline`
 * 与 WebSocket `/spend/logs/session/timeline/stream` 共用同一套读取、去重与增量判定，
 * 避免两个入口对同一会话给出不同结果。
 */

/**
 * Session 时间线的读取与实时装配。
 *
 * 时间线有两个独立来源：
 *   - 已落库的 SpendLogs：只追加、不再变化，按 (startTime, request_id) 升序读取；
 *   - 进行中的 ActiveRequests：随 checkpoint 反复变化，请求结束（落账）后删除。
 *
 * 这里把两者装配成同一份时间线，HTTP 一次性读取与 WebSocket 长连接共用同一实现：已落库
 * 部分只做增量追加（用消息计数高水位保持 payload 选择语义），进行中部分作为叠加层放在一份
 * fork 出来的 builder 副本上重算，已提交事件的去重状态不会被变化中的在途数据污染。
 *
 * 叠加层事件 id 与请求结算后的落库事件一致：结算只是换了事件来源，前端不会看到事件闪断。
 */

import { and, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { readLiveResponseSequence, readLiveResponseSnapshot } from "./LiveResponseRegistry";
import { hydrateSpendLogRows } from "./SpendLogBlocks";
import { createModuleLogger } from "../core/utils/logger";
import type { CallType } from "../types/spend";
import { getRequestResponsePayloadFromColdStorage } from "./SpendLogColdStorage";
import { readInProgressUsage } from "./UiLogDetail";
import { COLD_STORAGE_BATCH_CONCURRENCY, mapWithConcurrency } from "./spendManagementHelpers";
import { sessionTimelineRepositoryFor } from "../repositories/SessionTimelineRepository";
import { spendReportingRepositoryFor } from "../repositories/SpendReportingRepository";
import {
	SessionTimelineBuilder,
	isClaudeCodeAuxiliaryTimelineRequest,
	type SessionTimelineItem,
	type SessionTimelinePart,
	type SessionTimelineResponse,
	type SessionTimelineSourceRow,
	type SessionTimelineWindow,
} from "./sessionTimeline";
import { hydrateSessionTimelineImages, type SessionImageCandidate, type SessionImageLookup } from "./sessionTimelineImages";
import { encodeSessionPosition, sessionPositionFromRow, type SessionPosition } from "./sessionPosition";

const logger = createModuleLogger("SessionTimeline");

/**
 * 默认时间线窗口：最近多少个已落库请求。
 *
 * 累积式聊天快照随轮次线性增长，几千轮的会话整段读取要几十秒、响应上百 MB；
 * 最近几十轮足以支撑面板首屏，更早的内容用 `before` 游标按页读取。
 */
export const DEFAULT_SESSION_TIMELINE_WINDOW = 50;

/** 单次请求允许的最大窗口，避免前端一次拉回整段历史。 */
export const MAX_SESSION_TIMELINE_WINDOW = 500;

/**
 * 窗口的压缩消息体积预算。
 *
 * 累积式聊天快照的单行可以有上百 MB，只按条数切窗口仍会让一次读取 detoast 上 GB 数据；
 * 预算按 `pg_column_size` 判断（不读内容），把长会话一页的读取成本限制在几十 MB 量级。
 */
export const SESSION_TIMELINE_WINDOW_BYTE_BUDGET = 24 * 1024 * 1024;

/** 去重基线行允许的最大体积：超过它不如让窗口首行走有界尾部重扫。 */
export const SESSION_TIMELINE_BASELINE_MAX_BYTES = 8 * 1024 * 1024;

/** 单个请求最多补出多少条消息（缓存边界重写时只保留最近的这一段）。 */
export const SESSION_TIMELINE_MAX_MESSAGES_PER_REQUEST = 40;

/** 会话时间线的读取授权范围；可见性条件必须由已鉴权的调用方解析后传入。 */
export interface SessionTimelineScope {
	/** 规范会话分组键（`s:<uuid>` 或 `c:<user>`） */
	readonly groupKey: string;
	/** 是否保留 Claude Code 内部服务调用 */
	readonly includeAuxiliary: boolean;
	/** SpendLogs 的可见性条件，已包含显式 team 的成员校验 */
	readonly visibilityClause: SQL;
	/** 与 visibilityClause 对应的 ActiveRequests 可见性条件 */
	readonly activeVisibilityClause: SQL;
}

/** 一个进行中请求抽取出的事件组。 */
export interface SessionActiveTimelineRequest {
	/** 进行中请求的 ID，与结算后落库事件的 request_id 相同 */
	readonly request_id: string;
	/** 该请求当前可见的事件，顺序与最终落库后一致 */
	readonly events: SessionTimelineItem[];
}

/** 时间线响应：已落库事件，加上仍在进行中的请求事件组。 */
export interface SessionTimelinePayload extends SessionTimelineResponse {
	/** 仍在进行中的请求；已落库事件与它们互不重叠 */
	readonly active_requests: SessionActiveTimelineRequest[];
}

/** 一次增量推送：只包含发生变化的事件。 */
export interface SessionTimelineUpdate {
	/** 新增或内容变化的已落库事件 */
	readonly upsert: SessionTimelineItem[];
	/** 顺序变化时的完整事件 id 顺序；未变化时省略 */
	readonly order?: string[];
	/** 已消失的已落库事件 id；进行中请求结算时 id 会由落库事件接管，不会出现在这里 */
	readonly removed?: string[];
	/** 当前汇总，包含进行中请求 */
	readonly summary: SessionTimelineResponse["summary"];
	/** 当前全部进行中请求事件组，前端整体替换叠加层 */
	readonly active_requests: SessionActiveTimelineRequest[];
}

/** 已落库行的一次批量读取结果。 */
export interface SessionTimelineBatch {
	/** 本轮读到的已落库行，按 (startTime, request_id) 升序，已完成冷存储回填 */
	readonly rows: SessionTimelineSourceRow[];
	/** 本轮结束时的位置；空会话为 null */
	readonly position: SessionPosition | null;
	/** 快照上界内的会话总行数，用于判断增量追加是否覆盖了全部行 */
	readonly total: number;
	/** 已读到的消息计数高水位，下一次增量读取据此继续 payload 选择 */
	readonly seenMessageCount: number;
	/** 窗口内最早一行；没有行时为 null */
	readonly oldest: SessionPosition | null;
	/** 快照上界内是否还有比窗口更早的行 */
	readonly hasMore: boolean;
}

/** 可替换的读取依赖，便于测试构造确定的数据而不依赖数据库。 */
export interface SessionTimelineStreamDeps {
	/** 读取一批已落库行，默认走数据库 */
	readonly readBatch?: (
		db: NodePgDatabase<typeof schema>,
		scope: SessionTimelineScope,
		options: SessionTimelineBatchOptions,
	) => Promise<SessionTimelineBatch>;
	/** 读取会话内已落库行总数，用于发现新写入，默认走数据库 */
	readonly readSettledCount?: (db: NodePgDatabase<typeof schema>, scope: SessionTimelineScope) => Promise<number>;
	/** 读取进行中行，默认走数据库 */
	readonly readInProgress?: (db: NodePgDatabase<typeof schema>, scope: SessionTimelineScope) => Promise<SessionTimelineSourceRow[]>;
	/** 读取进行中行的变化指纹，默认走数据库 */
	readonly readInProgressRevision?: (db: NodePgDatabase<typeof schema>, scope: SessionTimelineScope) => Promise<string>;
	/** 图片回填查询；缺省时跳过图片解析 */
	readonly findImages?: (lookup: SessionImageLookup) => Promise<readonly SessionImageCandidate[]>;
	/** 分阶段耗时回调，用于 Server-Timing 之类的诊断响应头 */
	readonly recordTiming?: (name: string, startedAt: number) => void;
}

/** 一个会话时间线流在服务端的状态。 */
export interface SessionTimelineStreamState {
	/** 读取完整快照（含进行中请求）；连接建立或客户端重连时使用。 */
	snapshot(): Promise<SessionTimelinePayload>;
	/** 检查一次变化；没有可见变化时返回 null，因此不会空转推送。 */
	refresh(): Promise<SessionTimelineUpdate | null>;
}

/** 已落库行批次读取的可选参数。 */
export interface SessionTimelineBatchOptions {
	/** 只读该位置之后的行；缺省表示读整个会话 */
	readonly since?: SessionPosition | null;
	/** 只读该位置之前的行；用于向更早翻页 */
	readonly before?: SessionPosition | null;
	/** 只读该位置之后的行；用于向更新翻页 */
	readonly after?: SessionPosition | null;
	/** 翻页方向；缺省读最新窗口，`forward` 读最早窗口并向后翻页 */
	readonly direction?: "forward" | "backward";
	/** 最多读多少行；向后翻页取最早的 N 行，否则取最新的 N 行 */
	readonly limit?: number | null;
	/** 窗口的压缩消息体积预算；缺省用 {@link SESSION_TIMELINE_WINDOW_BYTE_BUDGET} */
	readonly byteBudget?: number | null;
	/** 已读到的消息计数高水位 */
	readonly seenMessageCount?: number;
	/** 分阶段耗时回调 */
	readonly recordTiming?: (name: string, startedAt: number) => void;
}

interface SessionTimelineDescriptorRow extends SessionTimelineSourceRow {
	readonly request_message_count: number | null;
	/** 最终上游请求里的消息条数；未记录上游时为 null。 */
	readonly upstream_message_count: number | null;
}

/** 时间线窗口参数：长会话只读一段，其余按 `before`/`after` 游标翻页。 */
export interface SessionTimelineWindowOptions {
	/** 最多返回多少个已落库请求；null/undefined 表示读取整个会话 */
	readonly limit?: number | null;
	/** 压缩消息体积预算；缺省用 {@link SESSION_TIMELINE_WINDOW_BYTE_BUDGET} */
	readonly byteBudget?: number | null;
	/** 只读该位置之前的请求 */
	readonly before?: SessionPosition | null;
	/** 只读该位置之后的请求 */
	readonly after?: SessionPosition | null;
	/** 翻页方向；缺省从最新请求往前读，`forward` 从最早请求往后读 */
	readonly direction?: "forward" | "backward";
}

interface SessionTimelinePayloadPlan {
	readonly indicesByRequestId: ReadonlyMap<string, readonly number[]>;
	readonly occurrencesByRequestId: ReadonlyMap<string, readonly number[]>;
	readonly deltaFlagsByRequestId: ReadonlyMap<string, readonly boolean[]>;
	/** Message-count high-water mark reached by this plan, to be carried into the next incremental read. */
	readonly seenMessageCount: number;
}

/**
 * 会话内已落库行的读取条件：分组建模列 + 已鉴权的可见性。
 * @param db - 数据库实例
 * @param scope - 读取范围
 */
function sessionBaseClause(db: NodePgDatabase<typeof schema>, scope: SessionTimelineScope): SQL {
	return and(spendReportingRepositoryFor(db).sessionGroupClause(scope.groupKey), scope.visibilityClause) as SQL;
}

/**
 * 按 (startTime, request_id) 升序比较两行的位置。
 * @param left - 左侧行
 * @param right - 右侧行
 */
function compareTimelinePositions(
	left: { readonly startTime: Date | string; readonly request_id: string },
	right: { readonly startTime: Date | string; readonly request_id: string },
): number {
	const leftTime = new Date(left.startTime).getTime();
	const rightTime = new Date(right.startTime).getTime();
	if (leftTime !== rightTime) {
		return leftTime - rightTime;
	}
	if (left.request_id === right.request_id) {
		return 0;
	}
	return left.request_id < right.request_id ? -1 : 1;
}

/** 窗口候选行：只读位置与压缩体积，`pg_column_size` 不触发 detoast。 */
interface SessionTimelineWindowScanRow {
	readonly request_id: string;
	readonly startTime: Date;
	readonly messages_bytes: number;
}

/**
 * 从按位置倒序的候选行里切出窗口：先按请求数，再按压缩后的字节预算。
 *
 * 累积式聊天快照的单行可达上百 MB，只按条数切窗口仍会把几十行上 GB 的内容拉进内存；
 * 字节预算用 `pg_column_size` 判断，不读内容，因此切窗口本身很便宜。最新一行永远保留，
 * 保证窗口不会为空。
 * @template T - 行类型，需带位置与压缩后的消息体积
 * @param descRows - 按 (startTime, request_id) 倒序的候选行
 * @param limit - 最多保留多少行
 * @param byteBudget - 压缩消息体积预算
 */
export function selectTimelineWindow<T extends { readonly request_id: string; readonly startTime: Date; readonly messages_bytes: number }>(
	descRows: readonly T[],
	limit: number,
	byteBudget: number,
): { rows: T[]; hasMore: boolean; predecessor: T | null } {
	// 显式排序，调用方给的顺序不影响窗口边界（数据库按位置倒序返回，测试夹具常用升序）。
	const ordered = [...descRows].sort((left, right) => compareTimelinePositions(right, left));
	const rows: T[] = [];
	let usedBytes = 0;
	let index = 0;
	while (index < ordered.length && rows.length < limit) {
		const row = ordered[index]!;
		const bytes = Number.isFinite(row.messages_bytes) ? row.messages_bytes : 0;
		if (rows.length > 0 && usedBytes + bytes > byteBudget) {
			break;
		}
		rows.push(row);
		usedBytes += bytes;
		index += 1;
	}
	const predecessor = index < ordered.length ? ordered[index]! : null;
	return { rows: rows.reverse(), hasMore: predecessor !== null, predecessor: predecessor };
}

/**
 * 从按位置升序的候选行里切出最早的窗口：先按请求数，再按压缩后的字节预算。
 *
 * 与 {@link selectTimelineWindow} 对称，供「最早优先」从会话开头向后翻页；最新一行永远保留，
 * 保证窗口不会为空。字节预算用 `pg_column_size` 判断，不读内容。
 * @template T - 行类型，需带位置与压缩后的消息体积
 * @param ascRows - 按 (startTime, request_id) 升序的候选行
 * @param limit - 最多保留多少行
 * @param byteBudget - 压缩消息体积预算
 */
export function selectForwardTimelineWindow<
	T extends { readonly request_id: string; readonly startTime: Date; readonly messages_bytes: number },
>(ascRows: readonly T[], limit: number, byteBudget: number): { rows: T[]; hasMore: boolean } {
	const ordered = [...ascRows].sort(compareTimelinePositions);
	const rows: T[] = [];
	let usedBytes = 0;
	let index = 0;
	while (index < ordered.length && rows.length < limit) {
		const row = ordered[index]!;
		const bytes = Number.isFinite(row.messages_bytes) ? row.messages_bytes : 0;
		if (rows.length > 0 && usedBytes + bytes > byteBudget) {
			break;
		}
		rows.push(row);
		usedBytes += bytes;
		index += 1;
	}
	return { rows: rows, hasMore: index < ordered.length };
}

/**
 * 读取窗口内的清单行，并顺带取窗口前一条请求的消息计数作为去重基线。
 *
 * 基线行只在体积允许时读取：为单独一行多花一次大 detoast 不划算，缺基线时返回 null，
 * 调用方退回有界尾部重扫。
 * @param db - 数据库实例
 * @param rangeClause - 已限制的读取范围
 * @param limit - 窗口内的最大请求数
 * @param byteBudget - 压缩消息体积预算
 */
async function readWindowedDescriptorRows(
	db: NodePgDatabase<typeof schema>,
	rangeClause: SQL,
	limit: number,
	byteBudget: number,
): Promise<{ rows: SessionTimelineDescriptorRow[]; hasMore: boolean; baselineMessageCount: number | null }> {
	const repository = sessionTimelineRepositoryFor(db);
	const scanRows = await repository.listWindowScanRows<SessionTimelineWindowScanRow>(rangeClause, "desc", limit + 1);
	const window = selectTimelineWindow(scanRows, limit, byteBudget);
	const windowRequestIds = window.rows.map((row) => row.request_id);
	const predecessor = window.predecessor;
	const readablePredecessor =
		predecessor !== null &&
		(!Number.isFinite(predecessor.messages_bytes) || predecessor.messages_bytes <= SESSION_TIMELINE_BASELINE_MAX_BYTES);
	const descriptorRequestIds = readablePredecessor ? [...windowRequestIds, predecessor.request_id] : windowRequestIds;
	const descriptorRows = await repository.listDescriptorRows<SessionTimelineDescriptorRow>(rangeClause, null, descriptorRequestIds);
	const byRequestId = new Map(descriptorRows.map((row) => [row.request_id, row]));
	const rows = windowRequestIds
		.map((requestId) => byRequestId.get(requestId))
		.filter((row): row is SessionTimelineDescriptorRow => row !== undefined);
	const baselineRow = readablePredecessor && predecessor !== null ? byRequestId.get(predecessor.request_id) : undefined;
	return {
		rows: rows,
		hasMore: window.hasMore,
		baselineMessageCount: baselineRow ? effectiveTimelineMessageCount(baselineRow) : null,
	};
}

/**
 * 从会话开头读取窗口内的清单行，并取游标行的消息计数作为向后翻页的去重基线。
 *
 * 游标行是上一页最后一条请求，也是本页首行之前的紧邻行；只在体积允许时读取它的计数，
 * 体积过大或行已不可见时返回 null，调用方退回有界尾部重扫。第一页没有游标，基线为 0。
 * @param db - 数据库实例
 * @param boundedClause - 快照上界内的会话范围
 * @param rangeClause - 已限制的读取范围（含 `after` 游标）
 * @param after - 上一页最后一条请求的位置；第一页为 null
 * @param limit - 窗口内的最大请求数
 * @param byteBudget - 压缩消息体积预算
 */
async function readForwardWindowedDescriptorRows(
	db: NodePgDatabase<typeof schema>,
	boundedClause: SQL,
	rangeClause: SQL,
	after: SessionPosition | null,
	limit: number,
	byteBudget: number,
): Promise<{ rows: SessionTimelineDescriptorRow[]; hasMore: boolean; baselineMessageCount: number | null }> {
	const repository = sessionTimelineRepositoryFor(db);
	const scanRows = await repository.listWindowScanRows<SessionTimelineWindowScanRow>(rangeClause, "asc", limit + 1);
	const window = selectForwardTimelineWindow(scanRows, limit, byteBudget);
	const windowRequestIds = window.rows.map((row) => row.request_id);
	const descriptorRows =
		windowRequestIds.length > 0
			? await repository.listDescriptorRows<SessionTimelineDescriptorRow>(rangeClause, null, windowRequestIds)
			: [];
	const byRequestId = new Map(descriptorRows.map((row) => [row.request_id, row]));
	const rows = windowRequestIds
		.map((requestId) => byRequestId.get(requestId))
		.filter((row): row is SessionTimelineDescriptorRow => row !== undefined);
	let baselineMessageCount: number | null = 0;
	if (after) {
		// 游标行按主键单行回表，不需要排序：WHERE request_id = $1 已唯一。
		const cursorClause = and(boundedClause, repository.spendLogRequestIdClause(after.requestId)) as SQL;
		const cursorScanRows = await repository.listWindowScanRows<SessionTimelineWindowScanRow>(cursorClause, null, 1);
		const cursorRow = cursorScanRows[0];
		const readableCursor =
			cursorRow !== undefined &&
			(!Number.isFinite(cursorRow.messages_bytes) || cursorRow.messages_bytes <= SESSION_TIMELINE_BASELINE_MAX_BYTES);
		if (readableCursor) {
			const baselineRows = await repository.listDescriptorRows<SessionTimelineDescriptorRow>(cursorClause, null, undefined, 1);
			const baselineRow = baselineRows[0];
			baselineMessageCount = baselineRow ? effectiveTimelineMessageCount(baselineRow) : null;
		} else {
			baselineMessageCount = null;
		}
	}
	return { rows: rows, hasMore: window.hasMore, baselineMessageCount: baselineMessageCount };
}

/**
 * 读取一批已落库行。
 *
 * 读取开始时先固定 `(startTime, request_id)` 上界，清单与 payload 查询因此看到同一批行；
 * `since` 给出时只读该位置之后的行，配合 `seenMessageCount` 让增量读取与一次性读取得到
 * 相同的消息去重结果。给出 `limit` 时只读最近一窗口：先按位置与压缩体积切窗口，再只对
 * 窗口内的行计算消息计数，长会话因此不会为几十条累积快照做上 GB 的 detoast。原始 payload
 * 只在本模块内消费，不会进入 HTTP 响应。
 * @param db - 数据库实例
 * @param scope - 读取范围
 * @param options - 窗口、起始位置、消息高水位与耗时回调
 */
export async function readSessionTimelineBatch(
	db: NodePgDatabase<typeof schema>,
	scope: SessionTimelineScope,
	options: SessionTimelineBatchOptions = {},
): Promise<SessionTimelineBatch> {
	const spendRepository = spendReportingRepositoryFor(db);
	const timelineRepository = sessionTimelineRepositoryFor(db);
	const baseClause = sessionBaseClause(db, scope);
	const snapshotStartedAt = performance.now();
	const snapshot = sessionPositionFromRow(
		await spendRepository.findSessionSnapshotPosition(baseClause),
		"snapshotStartTime",
		"snapshotRequestId",
	);
	options.recordTiming?.("snapshot", snapshotStartedAt);
	const countStartedAt = performance.now();
	if (!snapshot) {
		options.recordTiming?.("total", countStartedAt);
		return {
			rows: [],
			position: options.since ?? options.before ?? options.after ?? null,
			total: 0,
			seenMessageCount: options.seenMessageCount ?? 0,
			oldest: null,
			hasMore: false,
		};
	}
	const boundedClause = and(baseClause, spendRepository.sessionSnapshotClause(snapshot)) as SQL;
	const total = await spendRepository.countSpendLogs(boundedClause);
	options.recordTiming?.("total", countStartedAt);
	const direction: "forward" | "backward" = options.direction === "forward" || Boolean(options.after) ? "forward" : "backward";
	const rangeClause = options.since
		? (and(boundedClause, spendRepository.sessionCursorClause(options.since)) as SQL)
		: options.before
			? (and(boundedClause, spendRepository.sessionBeforeClause(options.before)) as SQL)
			: options.after
				? (and(boundedClause, spendRepository.sessionCursorClause(options.after)) as SQL)
				: boundedClause;
	// 增量读取只追新行，不需要窗口；一次性读取用窗口把整段累积快照挡在数据库里。
	const windowed = !options.since && options.limit !== null && options.limit !== undefined;

	const manifestStartedAt = performance.now();
	let rawDescriptorRows: SessionTimelineDescriptorRow[];
	let windowHasMore = false;
	let windowBaselineMessageCount: number | null = null;
	if (windowed) {
		const windowedRows =
			direction === "forward"
				? await readForwardWindowedDescriptorRows(
						db,
						boundedClause,
						rangeClause,
						options.after ?? null,
						options.limit as number,
						options.byteBudget ?? SESSION_TIMELINE_WINDOW_BYTE_BUDGET,
					)
				: await readWindowedDescriptorRows(
						db,
						rangeClause,
						options.limit as number,
						options.byteBudget ?? SESSION_TIMELINE_WINDOW_BYTE_BUDGET,
					);
		rawDescriptorRows = windowedRows.rows;
		windowHasMore = windowedRows.hasMore;
		windowBaselineMessageCount = windowedRows.baselineMessageCount;
	} else {
		rawDescriptorRows = await timelineRepository.listDescriptorRows<SessionTimelineDescriptorRow>(rangeClause, "asc");
	}
	options.recordTiming?.("manifest", manifestStartedAt);

	const classificationStartedAt = performance.now();
	const auxiliaryCandidateRequestIds = rawDescriptorRows
		.filter(
			(row) =>
				(typeof row.request_message_count === "number" && row.request_message_count <= 2) || row.request_message_count === null,
		)
		.map((row) => row.request_id);
	const classificationByRequestId = new Map<string, Partial<SessionTimelineSourceRow>>();
	if (auxiliaryCandidateRequestIds.length > 0) {
		const candidateRequestIdsJson = JSON.stringify(
			Object.fromEntries(auxiliaryCandidateRequestIds.map((requestId) => [requestId, true])),
		);
		const classificationRows = await timelineRepository.listAuxiliaryRows<
			Partial<SessionTimelineSourceRow> & { readonly request_id: string }
		>(
			windowed
				? (and(rangeClause, timelineRepository.spendLogRequestIdsClause(auxiliaryCandidateRequestIds)) as SQL)
				: (and(rangeClause, timelineRepository.spendLogSelectionKeyedByRequestIdClause(candidateRequestIdsJson)) as SQL),
		);
		for (const row of classificationRows) {
			classificationByRequestId.set(row.request_id, row);
		}
	}
	const descriptorRows = rawDescriptorRows.map((row) => ({
		...row,
		...(classificationByRequestId.get(row.request_id) ?? {}),
	}));
	options.recordTiming?.("classify", classificationStartedAt);

	const planningStartedAt = performance.now();
	// 窗口首行没有前序行时退回调用方传入的高水位（一次性读取为 0，增量读取为上次的计数）。
	const baselineMessageCount = windowBaselineMessageCount ?? options.seenMessageCount ?? 0;
	const payloadPlan = planSessionTimelinePayloads(descriptorRows, scope.includeAuxiliary, baselineMessageCount);
	const compactArrayPayloadRequestIds = [...payloadPlan.indicesByRequestId.keys()].filter(
		(requestId) => (payloadPlan.indicesByRequestId.get(requestId)?.length ?? 0) > 0,
	);
	const fallbackPayloadRequestIds = descriptorRows
		.filter((row) => row.internal_call_type !== "builtin_capability" && row.request_message_count === null)
		.map((row) => row.request_id);
	const payloadRequestIds = Array.from(new Set([...compactArrayPayloadRequestIds, ...fallbackPayloadRequestIds]));
	options.recordTiming?.("plan", planningStartedAt);

	const payloadByRequestId = new Map<string, unknown>();
	const payloadStartedAt = performance.now();
	if (payloadRequestIds.length > 0) {
		const selectedIndices = Object.fromEntries(
			payloadRequestIds.map((requestId) => [requestId, payloadPlan.indicesByRequestId.get(requestId) ?? []]),
		);
		const selectedIndicesJson = JSON.stringify(selectedIndices);
		const payloadRows = await timelineRepository.listPayloadRows<{ readonly request_id: string; readonly request_payload: unknown }>(
			windowed
				? (and(rangeClause, timelineRepository.spendLogRequestIdsClause(payloadRequestIds)) as SQL)
				: (and(rangeClause, timelineRepository.spendLogSelectionKeyedByRequestIdClause(selectedIndicesJson)) as SQL),
			selectedIndicesJson,
		);
		for (const row of payloadRows) {
			payloadByRequestId.set(row.request_id, row.request_payload);
		}
	}
	options.recordTiming?.("payload", payloadStartedAt);

	const compactRows = descriptorRows.map((row): SessionTimelineSourceRow => {
		const messageCount = effectiveTimelineMessageCount(row);
		const upstream = typeof row.upstream_message_count === "number" && row.upstream_message_count > 0;
		if (messageCount === null || messageCount === undefined) {
			return {
				...row,
				request_payload: payloadByRequestId.get(row.request_id) ?? row.request_payload,
			};
		}
		return {
			...row,
			request_payload: payloadByRequestId.get(row.request_id) ?? [],
			request_message_occurrences: payloadPlan.occurrencesByRequestId.get(row.request_id) ?? [],
			request_message_delta_flags: payloadPlan.deltaFlagsByRequestId.get(row.request_id) ?? [],
			request_payload_available: messageCount > 0,
			request_payload_upstream: upstream || undefined,
		};
	});
	const hydrationStartedAt = performance.now();
	const rows = await hydrateTimelineRowsFromColdStorage(compactRows);
	options.recordTiming?.("hydrate", hydrationStartedAt);

	const lastDescriptorRow = rawDescriptorRows.at(-1);
	const position: SessionPosition | null = lastDescriptorRow
		? { startTime: new Date(lastDescriptorRow.startTime), requestId: lastDescriptorRow.request_id }
		: (options.since ?? options.before ?? options.after ?? null);
	const firstDescriptorRow = rawDescriptorRows[0];
	const oldest: SessionPosition | null = firstDescriptorRow
		? { startTime: new Date(firstDescriptorRow.startTime), requestId: firstDescriptorRow.request_id }
		: null;
	return {
		rows: rows,
		position: position,
		oldest: oldest,
		hasMore: windowHasMore,
		total: total,
		seenMessageCount: payloadPlan.seenMessageCount,
	};
}

/**
 * 读取会话内已落库行总数。实时刷新用它判断是否有新落库行，比逐行对比位置便宜。
 * @param db - 数据库实例
 * @param scope - 读取范围
 */
export async function readSettledSessionCount(db: NodePgDatabase<typeof schema>, scope: SessionTimelineScope): Promise<number> {
	return spendReportingRepositoryFor(db).countSpendLogs(sessionBaseClause(db, scope));
}

/**
 * 会话内在途请求的读取条件。
 *
 * ActiveRequests 没有 session_group_key 列，注册时写入的 `metadata.session_group_key` 是唯一
 * 分组依据；过期行由心跳判定失效，与列表接口同样过滤。
 * @param db - 数据库实例
 * @param scope - 读取范围
 */
function sessionActiveClause(db: NodePgDatabase<typeof schema>, scope: SessionTimelineScope): SQL {
	return sessionTimelineRepositoryFor(db).sessionActiveClause(scope.groupKey, scope.activeVisibilityClause);
}

/**
 * 读取会话内仍在进行中的请求，转换成时间线行。
 * @param db - 数据库实例
 * @param scope - 读取范围
 */
export async function readInProgressSessionRows(
	db: NodePgDatabase<typeof schema>,
	scope: SessionTimelineScope,
): Promise<SessionTimelineSourceRow[]> {
	const rows = await sessionTimelineRepositoryFor(db).listActiveRequestRows<SessionActiveRequestSourceRow>(
		sessionActiveClause(db, scope),
	);
	// 在途行正文按内容寻址存块：先组装回完整请求体，分类判定与负载装配才看得到 messages/tools/system。
	// 块在注册提交后已进入进程缓存，正常路径不会多一次查询。
	const hydratedRows = await hydrateSpendLogRows(db, rows);
	return hydratedRows.map((row): SessionTimelineSourceRow => buildInProgressTimelineRow(row));
}

/**
 * 读取进行中行的变化指纹：数量 + 最近更新时间。
 *
 * checkpoint、心跳续租与一次性字段补写都会推进 `updated_at`，任何内容变化都会让指纹改变；
 * 指纹未变时可以跳过整批重读，空转刷新只花一次计数查询。
 * @param db - 数据库实例
 * @param scope - 读取范围
 */
export async function readInProgressSessionRevision(db: NodePgDatabase<typeof schema>, scope: SessionTimelineScope): Promise<string> {
	const revision = await sessionTimelineRepositoryFor(db).readActiveRequestRevision(sessionActiveClause(db, scope));
	return `${revision.count}|${revision.latest ?? ""}`;
}

/** ActiveRequests 行中时间线需要的字段。 */
interface SessionActiveRequestSourceRow {
	readonly request_id: string;
	readonly call_type: CallType;
	readonly api_key: string;
	readonly startTime: Date;
	readonly model: string;
	readonly metadata: unknown;
	readonly proxy_server_request: unknown;
	readonly completion_start_time: Date | null;
	readonly updated_at: Date;
}

/**
 * 从 `proxy_server_request` 里取出已补写的最终上游请求体。
 *
 * 在途行没有块编码；只有真正带有消息的上游体才算可用，否则继续展示下游请求。
 * @param proxyServerRequest - 在途行保存的请求结构
 */
function activeUpstreamRequestBody(proxyServerRequest: unknown): Record<string, unknown> | undefined {
	const proxy = isRecord(proxyServerRequest) ? proxyServerRequest : undefined;
	const upstream = isRecord(proxy?.["upstream_request"]) ? proxy["upstream_request"] : undefined;
	const body = isRecord(upstream?.["body"]) ? upstream["body"] : undefined;
	if (!body) {
		return undefined;
	}
	const messages = body["messages"];
	const input = body["input"];
	return (Array.isArray(messages) && messages.length > 0) || (Array.isArray(input) && input.length > 0) ? body : undefined;
}

/**
 * 把在途行转换成时间线行。
 *
 * 在途行没有最终 spend/状态；响应与用量来自最近一次 checkpoint，`updated_at` 当作当前结束
 * 位置，使进行中的事件时间戳与结算后的行保持同一时间轴。请求消息优先取已补写的上游请求，
 * 与已落库行使用同一套展示语义。
 * @param row - ActiveRequests 行
 */
function buildInProgressTimelineRow(row: SessionActiveRequestSourceRow): SessionTimelineSourceRow {
	const metadata = isRecord(row.metadata) ? row.metadata : {};
	// checkpoint 双 key 兼容——普通流式写 streaming_execution，CLIProxy 写 responses_execution，前者优先。
	const checkpoint = isRecord(metadata["streaming_execution"])
		? metadata["streaming_execution"]
		: isRecord(metadata["responses_execution"])
			? metadata["responses_execution"]
			: undefined;
	// 数据库里的同名字段是进程重启后的兜底；实时内容由 _applyLiveSnapshots 叠加。
	const usage = readInProgressUsage(checkpoint);
	const response = checkpoint?.["response"] ?? null;
	const upstreamBody = activeUpstreamRequestBody(row.proxy_server_request);
	return {
		request_id: row.request_id,
		call_type: row.call_type,
		api_key: row.api_key,
		key_alias: typeof metadata["user_api_key_alias"] === "string" ? metadata["user_api_key_alias"] : null,
		spend: 0,
		total_tokens: usage?.total_tokens ?? 0,
		startTime: row.startTime,
		endTime: row.updated_at,
		model: row.model,
		status: "in_progress",
		metadata_status: "in_progress",
		error_information: null,
		request_payload: upstreamBody ?? row.proxy_server_request,
		request_payload_available: true,
		request_payload_upstream: upstreamBody !== undefined || undefined,
		response_payload: response,
		response_payload_available: response !== null,
		...classifyActiveRequest(row.proxy_server_request),
	};
}

/** Claude Code CLI 的客户端标记：x-app 为 cli 且 User-Agent 以 claude-cli/ 开头。 */
const CLAUDE_CODE_CLI_APP = "cli";
const CLAUDE_CODE_CLI_USER_AGENT_PREFIX = "claude-cli/";
/** 与清单查询的 LEFT(...,256) 保持一致，只保留分类判断需要的提示词前缀。 */
const CLASSIFICATION_PROMPT_PREFIX_LENGTH = 256;

/**
 * 从在途行的原始请求推导辅助调用分类字段。
 *
 * 已落库行由 SQL 从 messages/proxy_server_request 投影这些字段；在途行没有 messages，直接在
 * 注册时保存的 proxy_server_request 上计算，使内部调用在进行中与结算后判定一致。
 * @param proxyServerRequest - 注册时保存的下游请求
 */
function classifyActiveRequest(proxyServerRequest: unknown): Partial<SessionTimelineSourceRow> {
	const proxy = isRecord(proxyServerRequest) ? proxyServerRequest : {};
	const headers = isRecord(proxy["headers"]) ? proxy["headers"] : {};
	const body = isRecord(proxy["body"]) ? proxy["body"] : {};
	const userAgent = typeof headers["user-agent"] === "string" ? headers["user-agent"] : "";
	const messages = Array.isArray(body["messages"]) ? body["messages"] : null;
	const system = Array.isArray(body["system"]) ? body["system"] : null;
	const tools = Array.isArray(body["tools"]) ? body["tools"] : null;
	const firstTool = isRecord(tools?.[0]) ? tools[0] : undefined;
	return {
		request_client:
			headers["x-app"] === CLAUDE_CODE_CLI_APP && userAgent.startsWith(CLAUDE_CODE_CLI_USER_AGENT_PREFIX) ? "claude_code" : null,
		request_message_count: messages?.length ?? null,
		request_system_count: system?.length ?? null,
		request_tool_count: tools?.length ?? null,
		request_first_tool_name: typeof firstTool?.["name"] === "string" ? firstTool["name"] : null,
		request_first_system_prompt: promptPrefix(system?.[0]),
		request_second_system_prompt: promptPrefix(system?.[1]),
	};
}

/**
 * 与 `LEFT(...,256)` 一致：字符串块或 `{type,text}` 块取文本前缀。
 * @param block - system 块
 */
function promptPrefix(block: unknown): string | null {
	const text = typeof block === "string" ? block : isRecord(block) && typeof block["text"] === "string" ? block["text"] : null;
	return text === null ? null : text.slice(0, CLASSIFICATION_PROMPT_PREFIX_LENGTH);
}

/**
 * 仅接受非 null 的普通对象。
 * @param value - 待判断的值
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 时间线响应中单张内联图片允许的最大字符数。
 *
 * 工具结果常把截图以 base64 内联在消息里，一次 50 条窗口的响应可达数十 MB；首屏只需要
 * 可读的对话，原图仍保留在日志详情中，因此超过该阈值的时间线图片改为占位。
 */
export const SESSION_TIMELINE_MAX_INLINE_IMAGE_CHARS = 256 * 1024;
const SESSION_TIMELINE_OMITTED_IMAGE_MESSAGE = "图片过大，时间线中已省略原图。";

/**
 * 压缩单个时间线部分，只改传输形态，不改事件语义。
 *
 * 体积主要来自两处：图片的 base64 文本；工具结果的原始 `data` 与结构化 `parts` 表达同一份
 * 内容。图片超过阈值时换为占位，已有结构化 `parts` 时省略重复的原始 `data`。
 * @param part - 原始内容块
 */
function compactSessionTimelinePart(part: SessionTimelinePart): SessionTimelinePart {
	const nestedParts = part.parts?.map(compactSessionTimelinePart);
	const nestedChanged = part.parts?.some((child, index) => nestedParts?.[index] !== child) ?? false;
	const source = isRecord(part.data) ? part.data.src : undefined;
	const omitImage = part.kind === "image" && typeof source === "string" && source.length > SESSION_TIMELINE_MAX_INLINE_IMAGE_CHARS;
	const dropData = part.kind === "tool_result" && part.data !== undefined && (nestedParts?.length ?? 0) > 0;
	if (!nestedChanged && !omitImage && !dropData) {
		return part;
	}
	const { data: _data, ...rest } = part;
	if (omitImage) {
		return {
			...rest,
			text: SESSION_TIMELINE_OMITTED_IMAGE_MESSAGE,
			data: { truncated: true },
			...(nestedParts ? { parts: nestedParts } : {}),
		};
	}
	return { ...rest, ...(nestedParts ? { parts: nestedParts } : {}) };
}

/**
 * 已压缩事件的缓存：已落库事件在多次快照/增量间保持同一引用，避免每帧重新扫描大内容块。
 */
const compactedTimelineEvents = new WeakMap<SessionTimelineItem, SessionTimelineItem>();

/**
 * 压缩一批时间线事件的内容块。
 * @param events - 原始事件
 */
function compactSessionTimelineEvents(events: readonly SessionTimelineItem[]): SessionTimelineItem[] {
	return events.map((event) => {
		const cached = compactedTimelineEvents.get(event);
		if (cached) {
			return cached;
		}
		if (!event.parts?.length) {
			compactedTimelineEvents.set(event, event);
			return event;
		}
		const parts = event.parts.map(compactSessionTimelinePart);
		const compacted = parts.some((part, index) => part !== event.parts?.[index]) ? { ...event, parts: parts } : event;
		compactedTimelineEvents.set(event, compacted);
		return compacted;
	});
}

/**
 * 压缩时间线响应中重复或过大的内容，降低长会话的传输、解析与首屏渲染成本。
 * @param payload - 完整装配结果
 */
export function compactSessionTimelinePayload(payload: SessionTimelinePayload): SessionTimelinePayload {
	return {
		...payload,
		data: compactSessionTimelineEvents(payload.data),
		active_requests: payload.active_requests.map((request) => ({
			...request,
			events: compactSessionTimelineEvents(request.events),
		})),
	};
}

/**
 * 时间线实际读取的消息条数。
 *
 * 请求消息优先来自最终上游请求，因此累计快照的推进也应按上游条数计算；只有上游未记录
 * （或没有可渲染消息）时才回退到下游 `messages` 列。
 * @param row - 清单行或进行中的行
 */
function effectiveTimelineMessageCount(row: {
	readonly request_message_count?: number | null;
	readonly upstream_message_count?: number | null;
}): number | null {
	const upstream = row.upstream_message_count;
	if (typeof upstream === "number" && Number.isSafeInteger(upstream) && upstream > 0) {
		return upstream;
	}
	return row.request_message_count ?? null;
}

/**
 * Select only positions beyond the cumulative message-count high-water mark.
 * Rows whose count does not advance are conservatively rescanned at the tail,
 * which keeps retries and non-cumulative payloads observable without hashing
 * every message in every historical snapshot.
 * @param rows - Chronologically ordered timeline manifest rows.
 * @param includeAuxiliary - Whether Claude Code internal service calls remain visible.
 * @param initialSeenMessageCount - High-water mark carried over by an incremental read.
 */
function planSessionTimelinePayloads(
	rows: readonly SessionTimelineDescriptorRow[],
	includeAuxiliary: boolean,
	initialSeenMessageCount: number,
): SessionTimelinePayloadPlan {
	let seenMessageCount = initialSeenMessageCount;
	const indicesByRequestId = new Map<string, readonly number[]>();
	const occurrencesByRequestId = new Map<string, readonly number[]>();
	const deltaFlagsByRequestId = new Map<string, readonly boolean[]>();

	for (const row of rows) {
		// 内置能力调用只保留审计标记，消息已经由父请求的最终上游请求带回，不再读取。
		if (row.internal_call_type === "builtin_capability") {
			indicesByRequestId.set(row.request_id, []);
			occurrencesByRequestId.set(row.request_id, []);
			deltaFlagsByRequestId.set(row.request_id, []);
			continue;
		}
		const messageCount = effectiveTimelineMessageCount(row);
		if (messageCount === null || !Number.isSafeInteger(messageCount) || messageCount < 0) {
			continue;
		}
		if (!includeAuxiliary && isClaudeCodeAuxiliaryTimelineRequest(row)) {
			indicesByRequestId.set(row.request_id, []);
			occurrencesByRequestId.set(row.request_id, []);
			deltaFlagsByRequestId.set(row.request_id, []);
			continue;
		}

		if (messageCount > seenMessageCount) {
			const growth = messageCount - seenMessageCount;
			if (growth >= 4) {
				// Large jumps in Claude/Codex histories coincide with prompt-cache
				// boundary rewrites: tool results and injected system messages can
				// change well before the tail. Rescan the recent window of the
				// snapshot only: on long agent sessions the full snapshot reaches
				// hundreds of megabytes, and dumping it would dominate the response
				// while the older part is already covered by earlier pages.
				const rescanStart = Math.max(0, messageCount - SESSION_TIMELINE_MAX_MESSAGES_PER_REQUEST);
				indicesByRequestId.set(
					row.request_id,
					Array.from({ length: messageCount - rescanStart }, (_unused, index) => rescanStart + index),
				);
				occurrencesByRequestId.set(row.request_id, []);
				deltaFlagsByRequestId.set(
					row.request_id,
					Array.from({ length: messageCount - rescanStart }, () => false),
				);
				seenMessageCount = messageCount;
				continue;
			}

			// Include two boundary messages because clients may rewrite cache
			// markers or reasoning representation immediately before the new
			// tail. Only positions at/after the old high-water mark are flagged
			// as genuinely new occurrences.
			const selectedStart = Math.max(0, seenMessageCount - 2);
			const selectedIndices = Array.from({ length: messageCount - selectedStart }, (_unused, offset) => selectedStart + offset);
			indicesByRequestId.set(row.request_id, selectedIndices);
			occurrencesByRequestId.set(row.request_id, []);
			deltaFlagsByRequestId.set(
				row.request_id,
				selectedIndices.map((index) => index >= seenMessageCount),
			);
			seenMessageCount = messageCount;
			continue;
		}

		// Equal/decreasing counts usually mean a retry or a non-cumulative
		// request. Re-read only the tail so a changed final turn remains visible;
		// the semantic reducer removes exact duplicates.
		const tailStart = Math.max(0, messageCount - 4);
		indicesByRequestId.set(
			row.request_id,
			Array.from({ length: messageCount - tailStart }, (_unused, offset) => tailStart + offset),
		);
		occurrencesByRequestId.set(row.request_id, []);
		deltaFlagsByRequestId.set(
			row.request_id,
			Array.from({ length: messageCount - tailStart }, () => false),
		);
	}

	return {
		indicesByRequestId: indicesByRequestId,
		occurrencesByRequestId: occurrencesByRequestId,
		deltaFlagsByRequestId: deltaFlagsByRequestId,
		seenMessageCount: seenMessageCount,
	};
}

function hasTimelinePayload(value: unknown): boolean {
	if (value === null || value === undefined) {
		return false;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed !== "" && trimmed !== "null" && trimmed !== "{}" && trimmed !== "[]";
	}
	if (Array.isArray(value)) {
		return value.length > 0;
	}
	if (typeof value === "object") {
		return Object.keys(value).length > 0;
	}
	return true;
}

async function hydrateTimelineRowsFromColdStorage(rows: readonly SessionTimelineSourceRow[]): Promise<SessionTimelineSourceRow[]> {
	return mapWithConcurrency(rows, COLD_STORAGE_BATCH_CONCURRENCY, async (row) => {
		const requestPayloadAvailable = row.request_payload_available ?? hasTimelinePayload(row.request_payload);
		const responsePayloadAvailable = row.response_payload_available ?? hasTimelinePayload(row.response_payload);
		if (requestPayloadAvailable && responsePayloadAvailable) {
			return row;
		}
		const payload = await getRequestResponsePayloadFromColdStorage(
			row.request_id,
			new Date(row.startTime),
			new Date(row.endTime),
			(_coldStorageLogger, error) => logger.warn(`/spend/logs/session/timeline 冷存储回查失败: ${(error as Error).message}`),
		);
		if (!payload) {
			return row;
		}
		const coldRequestPayload = hasTimelinePayload(payload.proxy_server_request) ? payload.proxy_server_request : payload.messages;
		return {
			...row,
			request_payload: requestPayloadAvailable ? row.request_payload : coldRequestPayload,
			response_payload: responsePayloadAvailable ? row.response_payload : payload.response,
		};
	});
}

/**
 * 构造图片回填查询：只在可见范围内按 key + 时间窗 + 提示词精确匹配唯一一次图片生成。
 * @param db - 数据库实例
 * @param visibilityClause - 已鉴权的可见性条件
 */
export function createSessionImageLookup(
	db: NodePgDatabase<typeof schema>,
	visibilityClause: SQL,
): (lookup: SessionImageLookup) => Promise<readonly SessionImageCandidate[]> {
	return async (lookup) => {
		const candidates = await sessionTimelineRepositoryFor(db).listImageCandidates({
			visibilityClause: visibilityClause,
			apiKey: lookup.apiKey,
			from: lookup.from,
			to: lookup.to,
			prompt: lookup.prompt,
		});
		if (candidates.length !== 1) {
			return candidates;
		}
		const candidate = candidates[0]!;
		const cold = await getRequestResponsePayloadFromColdStorage(candidate.requestId, lookup.from, lookup.to, () =>
			logger.warn("Session image cold-storage lookup failed"),
		);
		return [{ ...candidate, response: cold?.response ?? candidate.response }];
	};
}

/**
 * 会话时间线的服务端实时状态。
 *
 * 状态只保留三样东西：已落库 builder、已落库读取位置/计数、进行中行。每次刷新先比较两个
 * 廉价计数（已落库行数、进行中指纹），没有变化就不读行、不重建事件；变化时才交替读增量
 * 并重算叠加层，最后与上次推送的指纹比较，所以前端不会收到空帧。
 */
class SQLSessionTimelineStreamState implements SessionTimelineStreamState {
	private readonly _readBatch: NonNullable<SessionTimelineStreamDeps["readBatch"]>;
	private readonly _readSettledCount: NonNullable<SessionTimelineStreamDeps["readSettledCount"]>;
	private readonly _readInProgress: NonNullable<SessionTimelineStreamDeps["readInProgress"]>;
	private readonly _readInProgressRevision: NonNullable<SessionTimelineStreamDeps["readInProgressRevision"]>;
	private readonly _findImages: SessionTimelineStreamDeps["findImages"];
	private readonly _recordTiming: SessionTimelineStreamDeps["recordTiming"];
	private _settledBuilder: SessionTimelineBuilder;
	/** 已回填图片的已落库时间线 */
	private _settledResponse: SessionTimelineResponse | null = null;
	/** 已落库 builder 有了新行，需要重建响应 */
	private _settledDirty = true;
	/** 快照上界内的已落库行数，与下一次全量计数比较判断是否有新行 */
	private _loadedCount = 0;
	/** payload 选择使用的消息计数高水位 */
	private _seenMessageCount = 0;
	/** 已读到的最大位置；null 表示还没有已落库行 */
	private _position: SessionPosition | null = null;
	/** 各已落库请求的 key，用于图片回填，同时充当已落库 request_id 集合 */
	private readonly _keyByRequestId = new Map<string, string>();
	/** 进行中行，已剔除同一 request_id 已落库的重复行 */
	private _activeRows: SessionTimelineSourceRow[] = [];
	/** 上次读取进行中行时的指纹 */
	private _activeRevision: string | null = null;
	/** 进行中行在进程内存里的发布序号；正文变化不推进 updated_at，用它能发现新内容 */
	private _activeLiveSequence = "";
	/** 窗口参数：快照只读最近一段，长会话因此不会被整段累积快照拖慢 */
	private readonly _window: SessionTimelineWindowOptions;
	/** 上次快照返回的窗口信息；追加增量不改变它 */
	private _windowInfo: SessionTimelineWindow | null = null;
	/** 已推送事件的内容指纹与顺序，用于计算增量 */
	private _publishedSignatures = new Map<string, string>();
	private _publishedOrder: string[] = [];
	private _publishedSummary = "";
	private _publishedActiveSignature = "";
	/** 事件对象到内容指纹的缓存：已落库事件跨刷新保持同一引用，避免重复序列化 */
	private readonly _itemSignatures = new WeakMap<SessionTimelineItem, string>();

	public constructor(
		private readonly _db: NodePgDatabase<typeof schema>,
		private readonly _scope: SessionTimelineScope,
		deps: SessionTimelineStreamDeps,
		window: SessionTimelineWindowOptions = {},
	) {
		this._window = window;
		this._readBatch = deps.readBatch ?? readSessionTimelineBatch;
		this._readSettledCount = deps.readSettledCount ?? readSettledSessionCount;
		this._readInProgress = deps.readInProgress ?? readInProgressSessionRows;
		this._readInProgressRevision = deps.readInProgressRevision ?? readInProgressSessionRevision;
		this._findImages = deps.findImages;
		this._recordTiming = deps.recordTiming;
		this._settledBuilder = new SessionTimelineBuilder({ includeAuxiliary: this._scope.includeAuxiliary });
	}

	/** 读取完整快照并把它作为下一次增量的基线。 */
	public async snapshot(): Promise<SessionTimelinePayload> {
		await this._reloadSettled();
		await this._reloadActive();
		this._activeLiveSequence = this._collectLiveSequence();
		const payload = await this._compose();
		this._publish(payload);
		return this._windowInfo ? { ...payload, window: this._windowInfo } : payload;
	}

	/** 检查一次变化；没有可见变化时返回 null，调用方因此不会空转推送。 */
	public async refresh(): Promise<SessionTimelineUpdate | null> {
		const settledCount = await this._readSettledCount(this._db, this._scope);
		const activeRevision = await this._readInProgressRevision(this._db, this._scope);
		const settledChanged = settledCount !== this._loadedCount;
		const activeChanged = activeRevision !== this._activeRevision;
		// 流式正文只在进程内存里更新，不再推进 updated_at，需要单独看发布序号。
		const liveSequence = this._collectLiveSequence();
		const liveChanged = liveSequence !== this._activeLiveSequence;
		if (!settledChanged && !activeChanged && !liveChanged) {
			return null;
		}
		if (settledChanged) {
			await this._appendSettled();
		}
		// 落库与在途只在结算事务里同时变化：已落库有新行时也重读在途行，避免两边同时保留同一请求。
		await this._reloadActive();
		this._activeLiveSequence = this._collectLiveSequence();
		const payload = await this._compose();
		return this._publish(payload);
	}

	/** 重新读取整个已落库部分；首次快照与乱序落库时的一致性重建都走这里。 */
	private async _reloadSettled(): Promise<void> {
		const forward = this._window.direction === "forward" || Boolean(this._window.after);
		const batch = await this._readBatch(this._db, this._scope, {
			limit: this._window.limit ?? null,
			byteBudget: this._window.byteBudget ?? null,
			before: forward ? null : (this._window.before ?? null),
			after: forward ? (this._window.after ?? null) : null,
			direction: forward ? "forward" : "backward",
			recordTiming: this._recordTiming,
		});
		this._windowInfo = {
			returned_requests: batch.rows.length,
			total_requests: batch.total,
			has_more: batch.hasMore,
			before: !forward && batch.hasMore && batch.oldest ? encodeSessionPosition(batch.oldest) : null,
			after: batch.position ? encodeSessionPosition(batch.position) : null,
			limit: this._window.limit ?? null,
		};
		this._settledBuilder = new SessionTimelineBuilder({ includeAuxiliary: this._scope.includeAuxiliary });
		this._keyByRequestId.clear();
		for (const row of batch.rows) {
			this._settledBuilder.add(row);
			this._keyByRequestId.set(row.request_id, row.api_key ?? "");
		}
		this._loadedCount = batch.total;
		this._seenMessageCount = batch.seenMessageCount;
		this._position = batch.position;
		this._settledResponse = null;
		this._settledDirty = true;
	}

	/**
	 * 追加自上次读取以来新落库的行。
	 *
	 * `loadedCount + rows.length === total` 保证这批行正好补齐快照上界内的全部行；不成立说明
	 * 有行的落库顺序晚于其 `(startTime, request_id)` 位置（长请求晚结束），增量无法插回已有
	 * 顺序，只能整体重建。
	 */
	private async _appendSettled(): Promise<void> {
		if (this._position === null) {
			await this._reloadSettled();
			return;
		}
		const batch = await this._readBatch(this._db, this._scope, {
			since: this._position,
			seenMessageCount: this._seenMessageCount,
			recordTiming: this._recordTiming,
		});
		if (batch.total !== this._loadedCount + batch.rows.length) {
			await this._reloadSettled();
			return;
		}
		for (const row of batch.rows) {
			this._settledBuilder.add(row);
			this._keyByRequestId.set(row.request_id, row.api_key ?? "");
		}
		if (batch.rows.length > 0) {
			this._settledDirty = true;
			this._position = batch.position;
		}
		this._loadedCount = batch.total;
		this._seenMessageCount = batch.seenMessageCount;
	}

	/** 重新读取进行中的行，并剔除已经落库的 request_id。 */
	/**
	 * 用进程内存里的实时快照覆盖进行中行的正文与 token 数。
	 *
	 * 流式内容不再写进 ActiveRequests，所以数据库里的行只有注册时的静态信息；正文、usage
	 * 都在执行流的内存快照里（LiveResponseRegistry）。这里统一叠加，SQL 路径与测试替身
	 * 走同一条逻辑。
	 */
	private _applyLiveSnapshots(): void {
		if (this._activeRows.length === 0) {
			return;
		}
		this._activeRows = this._activeRows.map((row) => {
			const snapshot = readLiveResponseSnapshot(row.request_id);
			if (snapshot === null) {
				return row;
			}
			const live = snapshot as Record<string, unknown>;
			const usage = readInProgressUsage(live);
			const response = live["response"] ?? null;
			return {
				...row,
				response_payload: response,
				response_payload_available: response !== null,
				total_tokens: usage?.total_tokens ?? row.total_tokens,
			};
		});
	}

	/**
	 * 采集进行中行的内存发布序号。只做整数比较，不序列化正文，可以每秒调用。
	 */
	private _collectLiveSequence(): string {
		if (this._activeRows.length === 0) {
			return "";
		}
		const parts: string[] = [];
		for (const row of this._activeRows) {
			const sequence = readLiveResponseSequence(row.request_id);
			if (sequence > 0) {
				parts.push(`${row.request_id}#${sequence}`);
			}
		}
		return parts.join(",");
	}

	private async _reloadActive(): Promise<void> {
		const revision = await this._readInProgressRevision(this._db, this._scope);
		const rows = await this._readInProgress(this._db, this._scope);
		this._activeRows = rows.filter((row) => !this._keyByRequestId.has(row.request_id));
		this._applyLiveSnapshots();
		this._activeRevision = revision;
	}

	/** 已落库事件的响应；图片回填只对新出现的事件执行，已回填事件保持同一对象。 */
	private async _settledTimeline(): Promise<SessionTimelineResponse> {
		if (!this._settledDirty && this._settledResponse) {
			return this._settledResponse;
		}
		const previous = this._settledResponse;
		const built = this._settledBuilder.build();
		const keyRows = [...this._keyByRequestId].map(([requestId, apiKey]) => ({ request_id: requestId, api_key: apiKey }));
		if (!this._findImages || keyRows.length === 0) {
			this._settledResponse = built;
			this._settledDirty = false;
			return built;
		}
		const hydratedById = new Map<string, SessionTimelineItem>();
		if (previous) {
			for (const event of previous.data) {
				hydratedById.set(event.id, event);
			}
		}
		const pending = built.data.filter((event) => !hydratedById.has(event.id));
		if (pending.length > 0) {
			const hydrated = await hydrateSessionTimelineImages({ data: pending, summary: built.summary }, keyRows, this._findImages);
			for (const event of hydrated.data) {
				hydratedById.set(event.id, event);
			}
		}
		this._settledResponse = { data: built.data.map((event) => hydratedById.get(event.id) ?? event), summary: built.summary };
		this._settledDirty = false;
		return this._settledResponse;
	}

	/** 已落库事件 + 进行中事件组；两者互不重叠，前端可以直接拼接渲染。 */
	private async _compose(): Promise<SessionTimelinePayload> {
		const settled = await this._settledTimeline();
		if (this._activeRows.length === 0) {
			return compactSessionTimelinePayload({ data: settled.data, summary: settled.summary, active_requests: [] });
		}
		const overlay = this._settledBuilder.fork();
		const activeIds = new Set<string>();
		for (const row of this._activeRows) {
			overlay.add(row);
			activeIds.add(row.request_id);
		}
		const overlaid = overlay.build();
		const eventsByRequestId = new Map<string, SessionTimelineItem[]>();
		for (const event of overlaid.data) {
			if (!activeIds.has(event.request_id)) {
				continue;
			}
			const events = eventsByRequestId.get(event.request_id);
			if (events) {
				events.push(event);
			} else {
				eventsByRequestId.set(event.request_id, [event]);
			}
		}
		const activeRequests: SessionActiveTimelineRequest[] = [];
		for (const row of this._activeRows) {
			const events = eventsByRequestId.get(row.request_id);
			if (!events || events.length === 0) {
				continue;
			}
			activeRequests.push({
				request_id: row.request_id,
				events: await this._hydrateActiveEvents(row, events, overlaid.summary),
			});
		}
		return compactSessionTimelinePayload({ data: settled.data, summary: overlaid.summary, active_requests: activeRequests });
	}

	/**
	 * 进行中请求的图片回填；没有图片引用时不会产生查询。
	 * @param row - 进行中请求行，提供 key 身份
	 * @param events - 该请求当前的事件
	 * @param summary - 当前汇总，随事件一起传入回填函数
	 */
	private async _hydrateActiveEvents(
		row: SessionTimelineSourceRow,
		events: SessionTimelineItem[],
		summary: SessionTimelineResponse["summary"],
	): Promise<SessionTimelineItem[]> {
		if (!this._findImages || !row.api_key) {
			return events;
		}
		const hydrated = await hydrateSessionTimelineImages(
			{ data: events, summary: summary },
			[{ request_id: row.request_id, api_key: row.api_key }],
			this._findImages,
		);
		return hydrated.data;
	}

	/**
	 * 计算与上次推送的差异并记录新基线；没有可见变化时返回 null。
	 * @param payload - 本次装配出的完整时间线
	 */
	private _publish(payload: SessionTimelinePayload): SessionTimelineUpdate | null {
		const upsert: SessionTimelineItem[] = [];
		const nextSignatures = new Map<string, string>();
		for (const event of payload.data) {
			const signature = this._signatureOf(event);
			nextSignatures.set(event.id, signature);
			if (this._publishedSignatures.get(event.id) !== signature) {
				upsert.push(event);
			}
		}
		const removed = [...this._publishedSignatures.keys()].filter((id) => !nextSignatures.has(id));
		const order = payload.data.map((event) => event.id);
		const orderChanged = order.length !== this._publishedOrder.length || order.some((id, index) => id !== this._publishedOrder[index]);
		const activeSignature = this._activeSignature(payload.active_requests);
		const summarySignature = JSON.stringify(payload.summary);
		if (
			upsert.length === 0 &&
			removed.length === 0 &&
			!orderChanged &&
			activeSignature === this._publishedActiveSignature &&
			summarySignature === this._publishedSummary
		) {
			return null;
		}
		this._publishedSignatures = nextSignatures;
		this._publishedOrder = order;
		this._publishedActiveSignature = activeSignature;
		this._publishedSummary = summarySignature;
		return {
			upsert: upsert,
			...(orderChanged ? { order: order } : {}),
			...(removed.length > 0 ? { removed: removed } : {}),
			summary: payload.summary,
			active_requests: payload.active_requests,
		};
	}

	/**
	 * 进行中事件组的指纹：请求与事件的顺序、内容都参与比较。
	 * @param activeRequests - 当前进行中事件组
	 */
	private _activeSignature(activeRequests: readonly SessionActiveTimelineRequest[]): string {
		return activeRequests
			.map((group) => `${group.request_id}:${group.events.map((event) => this._signatureOf(event)).join(",")}`)
			.join("|");
	}

	/**
	 * 事件内容指纹；已落库事件对象跨刷新保持同一引用，可以安全缓存。
	 * @param event - 待比较的事件
	 */
	private _signatureOf(event: SessionTimelineItem): string {
		const cached = this._itemSignatures.get(event);
		if (cached !== undefined) {
			return cached;
		}
		const signature = JSON.stringify(event);
		this._itemSignatures.set(event, signature);
		return signature;
	}
}

/**
 * 创建会话时间线实时状态；HTTP 一次性读取与 WebSocket 长连接共用同一实现。
 * @param db - 数据库实例
 * @param scope - 读取范围
 * @param deps - 可替换的读取依赖
 * @param window - 窗口参数：长会话只读最近一段，缺省读取整个会话
 */
export function createSessionTimelineStreamState(
	db: NodePgDatabase<typeof schema>,
	scope: SessionTimelineScope,
	deps: SessionTimelineStreamDeps = {},
	window: SessionTimelineWindowOptions = {},
): SessionTimelineStreamState {
	return new SQLSessionTimelineStreamState(db, scope, deps, window);
}

/**
 * 一次性读取会话时间线（含进行中请求）。
 * @param db - 数据库实例
 * @param scope - 读取范围
 * @param deps - 可替换的读取依赖
 * @param window - 窗口参数：长会话只读最近一段，缺省读取整个会话
 */
export async function loadSessionTimeline(
	db: NodePgDatabase<typeof schema>,
	scope: SessionTimelineScope,
	deps: SessionTimelineStreamDeps = {},
	window: SessionTimelineWindowOptions = {},
): Promise<SessionTimelinePayload> {
	return createSessionTimelineStreamState(db, scope, deps, window).snapshot();
}
