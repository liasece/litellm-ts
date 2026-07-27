// fetch_models.ts

import { getRoutableModelCandidatesCall, modelHubCall } from "../../networking";

export interface ModelGroup {
	model_group: string;
	mode?: string;
	type?: "model" | "alias";
}

export interface ModelSelectOption {
	value: string;
	label: string;
}

/** 将模型候选转换为选择器选项：alias 前置、组内排序，并按原始名称去重。 */
export const modelGroupsToSelectOptions = (models: ModelGroup[]): ModelSelectOption[] => {
	const sortedModels = [...models].sort((left, right) => {
		const typeOrder = Number(right.type === "alias") - Number(left.type === "alias");
		return typeOrder || left.model_group.localeCompare(right.model_group);
	});
	const seenModelGroups = new Set<string>();

	return sortedModels.flatMap((model) => {
		if (seenModelGroups.has(model.model_group)) {
			return [];
		}
		seenModelGroups.add(model.model_group);
		return [
			{
				value: model.model_group,
				label: model.type === "alias" ? `Alias: ${model.model_group}` : `模型: ${model.model_group}`,
			},
		];
	});
};

/**
 * Fetches available models using modelHubCall and formats them for the selection dropdown.
 */
export const fetchAvailableModels = async (accessToken: string): Promise<ModelGroup[]> => {
	try {
		const fetchedModels = await modelHubCall(accessToken);
		console.log("model_info:", fetchedModels);

		if (fetchedModels?.data.length > 0) {
			const models: ModelGroup[] = fetchedModels.data.map((item: any) => ({
				model_group: item.model_group, // Display the model_group to the user
				mode: item?.mode, // Save the mode for auto-selection of endpoint type
			}));

			// Sort models alphabetically by label
			models.sort((a, b) => a.model_group.localeCompare(b.model_group));
			return models;
		}
		return [];
	} catch (error) {
		console.error("Error fetching model info:", error);
		throw error;
	}
};

/** Playground 使用 Router 的可路由逻辑模型和 alias，而非 deployment 模型组详情。 */
export const fetchRoutableModels = async (accessToken: string): Promise<ModelGroup[]> => {
	const candidates = await getRoutableModelCandidatesCall(accessToken);
	return candidates.map(({ model_name, mode, type }) => ({ model_group: model_name, mode, type }));
};
