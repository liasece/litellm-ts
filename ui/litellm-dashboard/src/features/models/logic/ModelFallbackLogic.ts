import { modelRecord } from "../support/ModelModels";

/** Replace only this model's chain, preserving peer entries and their routing order. */
export function updateModelFallbacks(current: unknown, modelName: string, selected: readonly string[]): Record<string, unknown> {
	const router = { ...modelRecord(current) };
	delete router.model_group_retry_policy;
	const existing: unknown[] = Array.isArray(router.fallbacks) ? router.fallbacks : [];
	let replaced = false;
	const merged = existing
		.map((entry) => {
			const next = { ...modelRecord(entry) };
			if (Object.prototype.hasOwnProperty.call(next, modelName)) {
				replaced = true;
				if (selected.length) next[modelName] = [...selected];
				else delete next[modelName];
			}
			return next;
		})
		.filter((entry) => Object.keys(entry).length > 0);
	if (!replaced && selected.length) merged.push({ [modelName]: [...selected] });
	return { ...router, fallbacks: merged };
}
