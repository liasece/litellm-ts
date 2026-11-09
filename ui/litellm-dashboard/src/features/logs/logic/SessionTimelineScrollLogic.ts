/** 时间线滚动容器的可观察状态；「更早」的一端随排序切换位置。 */
export interface TimelineScrollMetrics {
	/** 最新优先时更早的事件在列表末尾，最早优先时在列表开头。 */
	readonly newestFirst: boolean;
	readonly scrollTop: number;
	readonly clientHeight: number;
	readonly scrollHeight: number;
}

/** 距「更早」一端的提前量：滚动还没停稳就取页，翻页间隙不会露出空白。 */
export const TIMELINE_EARLIER_TRIGGER_DISTANCE = 240;

/** 判定「停在最新一端」的容差：像素级的滚动抖动不该被当成已经翻看历史。 */
export const TIMELINE_NEWEST_END_TOLERANCE = 8;

/**
 * 判断读者是否已经到达「更早」的一端。
 *
 * 没有可滚动空间时返回 false：一次窗口已经占满面板，继续自动取页会把整段历史连着拉回来，
 * 这种情况交给面板上的「加载更早」按钮。
 * @param metrics - 滚动容器的当前尺寸与偏移
 * @param distance - 触发距离，默认取 `TIMELINE_EARLIER_TRIGGER_DISTANCE`
 */
export function reachesTimelineEarlierEnd(metrics: TimelineScrollMetrics, distance = TIMELINE_EARLIER_TRIGGER_DISTANCE): boolean {
	const span = metrics.scrollHeight - metrics.clientHeight;
	if (!(span > 0)) return false;
	const remaining = metrics.newestFirst ? span - metrics.scrollTop : metrics.scrollTop;
	return Number.isFinite(remaining) && remaining <= distance;
}

/**
 * 内容变化后是否要用锚点补回滚动位置。
 *
 * 最新优先时列表顶端就是最新事件：读者停在顶端说明正在追最新内容，新事件应当直接出现在视野
 * 里，补回偏移反而把新内容顶走。只要读者往下翻看过历史，后来的事件插在视野上方就不能改变
 * 当前读到的地方。最早优先时实时事件追加在末尾，视野上方变动的只有「加载更早」补进来的页，
 * 同样需要补回。
 * @param metrics - 内容变化前的滚动状态
 * @param tolerance - 「停在最新一端」的容差，默认取 `TIMELINE_NEWEST_END_TOLERANCE`
 */
export function keepsTimelineScrollAnchor(metrics: TimelineScrollMetrics, tolerance = TIMELINE_NEWEST_END_TOLERANCE): boolean {
	if (!metrics.newestFirst) return true;
	return !(Number.isFinite(metrics.scrollTop) && metrics.scrollTop <= tolerance);
}

/**
 * 锚点条目相对容器视口的漂移量，加到 `scrollTop` 上就能让读者看到的位置保持不动。
 * @param previousOffset - 内容变化前锚点相对容器视口顶部的偏移
 * @param nextOffset - 内容变化后锚点相对容器视口顶部的偏移
 */
export function timelineAnchorShift(previousOffset: number, nextOffset: number): number {
	return Number.isFinite(previousOffset) && Number.isFinite(nextOffset) ? nextOffset - previousOffset : 0;
}
