import type { LogEntry } from "../support/LogsModels";

/**
 * 在若干条日志序列里按顺序找相邻的一条。
 *
 * 详情抽屉有两条导航序列：会话内的事件，以及当前页的日志列表。会话视图优先走会话内
 * 的事件，这样 J/K 与左侧 trace 列表同步；但一次调用就是一个 Session 时（生产上几乎
 * 都是如此），会话里只有当前这一行，只按会话走会让 J/K 看起来完全没反应。所以某条序列
 * 走到头或根本不含当前行时，继续试下一条序列，最后退回日志列表的相邻行。
 * @param sequences - 按优先级排列的序列，通常是 [会话行, 当前页列表]
 * @param currentId - 当前打开的 request_id
 * @param offset - 1 取下一条，-1 取上一条
 * @returns 相邻的一行；所有序列都没有相邻行时为 null
 */
export function adjacentLog(sequences: readonly (readonly LogEntry[])[], currentId: string, offset: number): LogEntry | null {
	for (const values of sequences) {
		const index = values.findIndex((row) => row.request_id === currentId);
		if (index < 0) continue;
		const target = values[index + offset];
		if (target) return target;
	}
	return null;
}
