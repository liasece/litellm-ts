/**
 * 把列表中的一项移动到另一个位置，供拖拽和键盘排序共用。
 *
 * 用 splice 移动而不是交换：把第 1 项拖到第 3 项时，用户期望它成为新的第 3 项、
 * 原来的第 2/3 项依次前移；交换会让中间项停在原地，和手势落点不一致。
 */
export function moveListItem<T>(items: readonly T[], from: number, to: number): T[] {
	const next = [...items];
	if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item);
	return next;
}
