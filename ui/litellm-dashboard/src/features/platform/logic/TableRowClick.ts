/**
 * 列表行点击辅助：判断事件是否来自行内交互控件。
 *
 * 行内按钮（复制、编辑、删除、链接等）各自处理点击，
 * 行级“打开详情/编辑”不应重复触发。
 */

/** 行内交互控件选择器（含显式忽略标记）。 */
export const TABLE_ROW_INTERACTIVE_SELECTOR = "button, a, input, select, textarea, label, [data-row-click='ignore']";

/**
 * @param event - 行上的点击事件
 * @returns 点击目标位于行内交互控件内部
 */
export function isTableRowInteractiveTarget(event: Event): boolean {
	const target = event.target;
	return target instanceof Element && target.closest(TABLE_ROW_INTERACTIVE_SELECTOR) !== null;
}
