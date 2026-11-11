import type { UiTableFilterChoice } from "../../platform/ui/UiTableFilterModels";
import { record } from "./LogsPresentationLogic";

/**
 * End User 表头过滤器的候选上限。
 *
 * 端用户表可能有数万行，全量下发（实测 22 MB）会让每次输入都重下一整份列表；
 * 这里与 Model / Key Alias 选择器一样只要一页候选。
 */
export const END_USER_CHOICE_LIMIT = 50;

/**
 * 构造 End User 候选查询；`search` 由服务端按 user_id 做大小写不敏感包含匹配。
 * @param term - 用户在筛选面板里输入的搜索词
 */
export function endUserChoicesQuery(term: string): string {
	const params = new URLSearchParams({ size: String(END_USER_CHOICE_LIMIT) });
	const query = term.trim();
	if (query) params.set("search", query);
	return "/customer/list?" + params.toString();
}

/**
 * 把 `/customer/list` 的响应映射成筛选候选项；非字符串 user_id 的行跳过。
 * @param data - 服务端返回的端用户数组
 */
export function endUserChoices(data: unknown): UiTableFilterChoice[] {
	if (!Array.isArray(data)) return [];
	return data.flatMap((item) => {
		const id = record(item).user_id;
		return typeof id === "string" && id ? [{ label: id, value: id }] : [];
	});
}
