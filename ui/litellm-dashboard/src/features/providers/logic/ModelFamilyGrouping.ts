import { resolveModelFamily, type ModelFamily } from "../../../../../../src/shared/ModelFamily";

/** 未识别品牌的条目单独成组，键与家族名区分开，避免与真实家族重名。 */
export const unknownFamilyKey = "unknown";

export interface ModelFamilyGroup<T> {
	/** 家族名，或 {unknownFamilyKey}；用作 v-for 的 key。 */
	key: string;
	family: ModelFamily | null;
	items: T[];
}

/**
 * 按品牌家族把列表切成连续分组，组内保持调用方给的顺序。
 *
 * 分组覆盖调用方的排序主键：先把同家族的条目收在一起，再保留原有顺序（例如按费用排序时，
 * 费用顺序只在集团内生效）。未识别品牌的条目固定排在最前，因为它们通常是别名或自起名的部署，
 * 需要先看见。
 * @param items
 * @param familyOf
 */
export function groupByModelFamily<T>(items: readonly T[], familyOf: (item: T) => ModelFamily | null | undefined): ModelFamilyGroup<T>[] {
	const groups = new Map<string, ModelFamilyGroup<T>>();
	for (const item of items) {
		const family = familyOf(item) ?? null;
		const key = family ?? unknownFamilyKey;
		const existing = groups.get(key);
		if (existing) existing.items.push(item);
		else groups.set(key, { key, family, items: [item] });
	}
	return [...groups.values()].sort((left, right) => {
		if (left.family === right.family) return 0;
		if (left.family === null) return -1;
		if (right.family === null) return 1;
		return left.family.localeCompare(right.family);
	});
}

/** 按家族名识别部署或别名条目所属的家族；识别不出时返回 undefined。 */
export function familyOfModel(model: string, baseModel?: string): ModelFamily | undefined {
	return resolveModelFamily(model, baseModel);
}
