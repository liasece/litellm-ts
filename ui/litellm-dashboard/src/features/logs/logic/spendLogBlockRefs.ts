/**
 * Spend Log 内容寻址块的缺失引用识别。
 *
 * 后端把对话消息按内容寻址存进块表，读取时如果引用的块行已经不存在，会在原消息位置放一个
 * 只含 {@link SPEND_LOG_REF_MISSING_KEY} 的对象，保证数组长度与其它消息的位置不变。渲染层
 * 需要把这种占位当作「内容不可用」提示，而不是当成普通消息对象输出。
 */

/** 组装消息时找不到块内容的占位键，与后端 `SPEND_LOG_REF_MISSING_KEY` 一致。 */
export const SPEND_LOG_REF_MISSING_KEY = "_litellm_ref_missing";

/**
 * 判断一个值是否为缺块占位对象。
 *
 * 必须是只带占位键的普通对象，且键值是非空字符串。普通消息对象、数组、字符串以及
 * 额外带 `role`/`content` 等字段的对象都不算，避免把正常内容误判成缺失提示。
 * @param value - 消息数组里的一个元素
 */
export function isMissingSpendLogBlockRef(value: unknown): boolean {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	const blockId = record[SPEND_LOG_REF_MISSING_KEY];
	return keys.length === 1 && keys[0] === SPEND_LOG_REF_MISSING_KEY && typeof blockId === "string" && blockId.length > 0;
}
