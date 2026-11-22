/**
 * 在途请求回收。
 *
 * 进程启动时把上个进程遗留的 `in_progress` 行转成 aborted SpendLog；运行期巡检把
 * 心跳已停（租约过期）的孤儿行做同样处理。两条路径都是单条跨表语句：
 * 插入终态日志、释放预留、删除在途行在同一事务内完成（SQL 见 ActiveRequestRepository）。
 *
 * 回收 SQL 用 `INSERT ... SELECT` 直接搬 `proxy_server_request`，绕过正常写路径的内容
 * 寻址编码；这里在同一个事务里补做编码，规则与正常落账完全一致。
 */

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { createModuleLogger } from "../core/utils/logger";
import type { DrizzleDb } from "../core/db/Database";
import { activeRequestRepositoryFor } from "../repositories/ActiveRequestRepository";
import { spendLogBlockRepositoryFor } from "../repositories/SpendLogBlockRepository";
import { spendLogRepositoryFor } from "../repositories/SpendLogRepository";
import {
	type SpendLogBlockRecord,
	collectReferencedBlockIds,
	collectSpendLogBlocks,
	prepareSpendLogProxyForStorage,
	selectMissingSpendLogBlocks,
	shouldDeduplicateSpendLogBlocks,
} from "./SpendLogBlocks";
import { publishSpendLogChange } from "./spendLogChangeFeed";

const logger = createModuleLogger("Spend:ActiveRequestRecovery");

/** 回收事务句柄，用于在同一个事务里补做内容寻址编码。 */
type RecoveryTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];

export const ACTIVE_REQUEST_ABORT_REASON_SERVER_RESTART = "server_restart";
/** 租约过期回收写入的终止原因（见 reapExpiredActiveRequests）。 */
export const ACTIVE_REQUEST_ABORT_REASON_LEASE_EXPIRED = "lease_expired";

/**
 * 取得与事务句柄绑定的流水仓储。
 *
 * 仓储持有的是连接级不变状态（这里没有缓存），事务句柄只作为取用键；真正的语句都显式
 * 接收 `tx`，因此不会出现事务外的连接读写。
 * @param tx - 回收事务句柄
 * @returns 流水仓储
 */
function spendLogRepositoryForTx(tx: RecoveryTransaction) {
	return spendLogRepositoryFor(tx as unknown as DrizzleDb);
}

/**
 * 把刚回收的 SpendLog 行换成内容寻址引用。
 *
 * 两条回收 SQL 都是 `INSERT ... SELECT`，直接把 `proxy_server_request` 原样搬进
 * SpendLogs，因此绕过了正常写入路径的块编码 —— 一次重启就能留下几行 1 MB 以上的
 * 完整请求体。这里在同一个事务里补做编码，规则与 {@link collectSpendLogBlocks}
 * 完全一致。
 *
 * 只处理本次刚插入的行（按 termination_reason 精确定位），已编码的行跳过；任何异常
 * 只记录日志 —— 行里保留原始请求体依然可读，去重是存储优化，不应影响启动恢复。
 * @param tx - 回收事务
 * @param requestIds - 本次回收的 request_id
 * @param terminationReason - 本次回收写入的 metadata.termination_reason
 */
async function encodeRecoveredRequestPayloads(
	tx: RecoveryTransaction,
	requestIds: readonly string[],
	terminationReason: string,
): Promise<void> {
	if (requestIds.length === 0) {
		return;
	}
	try {
		if (!(await shouldDeduplicateSpendLogBlocks())) {
			return;
		}
		const rows = await spendLogRepositoryForTx(tx).findProxyPayloadsForRecovery(tx, requestIds, terminationReason);
		const blocks = new Map<string, SpendLogBlockRecord>();
		const updates: Array<{ requestId: string; proxyServerRequest: unknown }> = [];
		for (const row of rows) {
			// 已经带引用键的行跳过：再编码一次会把引用当成字面量剥掉，反而丢掉内容。
			if (collectReferencedBlockIds({}, row.proxyServerRequest).length > 0) {
				continue;
			}
			// 回收行可能由旧进程写入，补做一次与正常写路径相同的认证头脱敏和内部字段清理。
			const preparedProxy = prepareSpendLogProxyForStorage(row.proxyServerRequest);
			const encoding = collectSpendLogBlocks({ messages: {}, proxyServerRequest: preparedProxy });
			if (encoding.blocks.length === 0) {
				continue;
			}
			for (const block of encoding.blocks) {
				blocks.set(block.blockId, block);
			}
			updates.push({ requestId: row.requestId, proxyServerRequest: encoding.proxyServerRequest });
		}
		if (updates.length === 0) {
			return;
		}
		const blockList = [...blocks.values()];
		// 回收行里的历史正文在正常写入路径上大多已经存在，先判存，只补写缺失的块。
		const blocksToInsert = await selectMissingSpendLogBlocks(tx, blockList);
		if (blocksToInsert.length > 0) {
			await spendLogBlockRepositoryFor(tx as unknown as DrizzleDb).insertIgnore(blocksToInsert, tx);
		}
		for (const update of updates) {
			await spendLogRepositoryForTx(tx).updateProxyServerRequest(tx, update.requestId, update.proxyServerRequest);
		}
		logger.info("回收行已按内容寻址去重", { recovered: updates.length, blocks: blocksToInsert.length });
	} catch (error) {
		logger.warn("回收行内容寻址去重失败，保留原始请求体", { error: error, requests: requestIds.length });
	}
}

/**
 * 将进程启动前遗留的在途请求转换为可审计的 aborted SpendLog。
 *
 * 单实例服务只在开始监听端口前调用本函数，因此此时全部 in_progress 行都属于旧进程。
 * 插入终态日志、释放预算预留、删除 ActiveRequests 在同一事务中完成；已 checkpoint 的
 * response/usage 会保留（checkpoint 双 key 兼容：普通流式写 streaming_execution、
 * CLIProxy 写 responses_execution，前者优先），未知 usage 与费用保持为 0。proxy_server_request
 * 列随行保留，使 aborted 日志仍能查看原始 request。
 *
 * checkpoint 载荷只用于还原 response 列与用量列，写日志 metadata 前必须剥掉：那份累计正文
 * 单行可达数兆，留在 metadata 会让列表响应、Session 读取和 metadata 过滤一起背上整份正文。
 * @param db - Drizzle 数据库实例
 * @param abortedAt - 本次恢复发生的时间
 * @returns 已回收的请求数量
 */
export async function abortOrphanedActiveRequests(db: NodePgDatabase<typeof schema>, abortedAt: Date = new Date()): Promise<number> {
	const recovered = await db.transaction(async (tx) => {
		const requestIds = await activeRequestRepositoryFor(db).abortOrphaned(tx, abortedAt);
		await encodeRecoveredRequestPayloads(tx, requestIds, ACTIVE_REQUEST_ABORT_REASON_SERVER_RESTART);
		return requestIds.length;
	});
	if (recovered > 0) {
		publishSpendLogChange();
	}
	return recovered;
}

/**
 * 回收租约已过期、但进程仍在运行的在途请求。
 *
 * 与启动恢复不同，这里只按 `expires_at` 判定：心跳仍在续租的真实长流不会被误伤。
 * 回收逻辑与启动恢复共用同一条跨表语句，避免两套回收路径产生不同的终态行。
 * @param db - Drizzle 数据库实例
 * @param now - 判定基准时刻，缺省取当前时间
 * @returns 已回收的请求数量
 */
export async function reapExpiredActiveRequests(db: NodePgDatabase<typeof schema>, now: Date = new Date()): Promise<number> {
	const recovered = await db.transaction(async (tx) => {
		const requestIds = await activeRequestRepositoryFor(db).reapExpired(tx, now);
		await encodeRecoveredRequestPayloads(tx, requestIds, ACTIVE_REQUEST_ABORT_REASON_LEASE_EXPIRED);
		return requestIds.length;
	});
	if (recovered > 0) {
		publishSpendLogChange();
	}
	return recovered;
}
