import { replaceEqualDeep } from "@tanstack/react-query";

/**
 * Live tail 每次轮询都会返回整页日志，新日志插到最前面，于是所有下标都往后挪一格。
 * React Query 默认的 structural sharing 按下标比较数组，挪位后每一项都对不上，
 * 行的 props 引用全部变化，100 行 × 10 列的单元格（还有每个单元格里的 Tooltip/Popover）
 * 都要重新渲染，单次刷新约 180ms、期间最长一次长任务 260ms。
 *
 * 这里改为按 request_id 匹配新旧记录：内容完全相同的记录继续复用旧对象引用，
 * 行级 memo 就能跳过它们，一次刷新只剩新增/变化的那几行需要渲染。
 */
export interface LogsPage<TEntry extends { request_id: string }> {
	data: TEntry[];
	total: number;
	page: number;
	page_size: number;
	total_pages: number;
}

const hasRequestId = <TEntry extends { request_id: string }>(entry: TEntry | undefined | null): boolean =>
	!!entry && typeof entry.request_id === "string" && entry.request_id.length > 0;

export function shareLogsPageIdentity<
	TPage extends LogsPage<TEntry>,
	TEntry extends { request_id: string } = TPage["data"][number],
>(previous: TPage | undefined, next: TPage): TPage {
	if (!previous || !Array.isArray(previous.data) || !Array.isArray(next?.data)) {
		return replaceEqualDeep(previous, next) as TPage;
	}

	const previousById = new Map<string, TEntry>();
	for (const entry of previous.data) {
		if (hasRequestId(entry)) {
			previousById.set(entry.request_id, entry);
		}
	}

	let entriesChanged = false;
	const data = next.data.map((entry) => {
		const before = hasRequestId(entry) ? previousById.get(entry.request_id) : undefined;
		if (!before) {
			entriesChanged = true;
			return entry;
		}
		const shared = replaceEqualDeep(before, entry) as TEntry;
		if (shared !== before) {
			entriesChanged = true;
		}
		return shared;
	});

	const samePage =
		next.total === previous.total &&
		next.page === previous.page &&
		next.page_size === previous.page_size &&
		next.total_pages === previous.total_pages &&
		data.length === previous.data.length;

	if (!entriesChanged && samePage) {
		return previous;
	}

	return { ...next, data };
}
