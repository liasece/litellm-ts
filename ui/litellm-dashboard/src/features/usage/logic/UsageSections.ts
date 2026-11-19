/** 用量统计的分区；前四个按用量数据切分，quota 是独立的账号额度页。 */
export type UsageSection = "cost" | "models" | "keys" | "endpoints" | "quota";

const sectionsByPage: Readonly<Record<string, UsageSection>> = {
	new_usage: "cost",
	"usage-models": "models",
	"usage-keys": "keys",
	"usage-endpoints": "endpoints",
	"usage-quota": "quota",
};

/**
 * 页面 id → 用量统计分区。
 * @param page - 由 URL 解析出的页面 id；未登记的 id 回落到 Cost，它是这组页面的默认视图。
 */
export function usageSection(page: string): UsageSection {
	return sectionsByPage[page] ?? "cost";
}

/** 分区对应的页面 id，侧边栏与其他页面链接这里取地址。 */
export const pageByUsageSection: Readonly<Record<UsageSection, string>> = {
	cost: "new_usage",
	models: "usage-models",
	keys: "usage-keys",
	endpoints: "usage-endpoints",
	quota: "usage-quota",
};
