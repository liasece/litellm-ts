/** 模型管理的分区；每个分区在侧边栏各占一项，对应一条路由。 */
export type ModelManagementSection = "models" | "credentials" | "retries" | "aliases" | "prices";

const sectionsByPage: Readonly<Record<string, ModelManagementSection>> = {
	models: "models",
	"models-credentials": "credentials",
	"models-retries": "retries",
	"models-aliases": "aliases",
	"models-prices": "prices",
};

/**
 * 页面 id → 模型管理分区。
 * @param page - 由 URL 解析出的页面 id；未登记的 id 回落到 All Models，避免空白页。
 */
export function modelManagementSection(page: string): ModelManagementSection {
	return sectionsByPage[page] ?? "models";
}

/** 分区对应的页面 id。 */
export const pageByModelSection: Readonly<Record<ModelManagementSection, string>> = {
	models: "models",
	credentials: "models-credentials",
	retries: "models-retries",
	aliases: "models-aliases",
	prices: "models-prices",
};

/** 旧地址 `?page=models&tab=health` 里的 tab 取值 → 分区，历史书签重定向用。 */
const sectionsByLegacyTab: Readonly<Record<string, ModelManagementSection>> = {
	models: "models",
	"add-model": "models",
	credentials: "credentials",
	health: "models",
	retries: "retries",
	aliases: "aliases",
	"price-data": "prices",
};

export function modelSectionFromLegacyTab(tab: string): ModelManagementSection | undefined {
	return Object.prototype.hasOwnProperty.call(sectionsByLegacyTab, tab) ? sectionsByLegacyTab[tab] : undefined;
}
