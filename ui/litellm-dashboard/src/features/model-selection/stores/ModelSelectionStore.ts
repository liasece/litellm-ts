import { computed, ref } from "vue";
import { fetchModelGroupChoices } from "../api/ModelSelectionApi";
import type { ModelGroupChoice } from "../support/ModelSelectionModels";
export function createModelSelectionStore(
	value: string | undefined,
	onChange: (value: string) => void,
	loadGroups = fetchModelGroupChoices,
) {
	const selected = ref(value),
		custom = ref(false),
		customText = ref(""),
		groups = ref<ModelGroupChoice[]>([]),
		loading = ref(false);
	let timer: ReturnType<typeof setTimeout> | undefined,
		generation = 0,
		disposed = false;
	const options = computed(() => [
		...[...new Set(groups.value.map((group) => group.model_group))].map((name) => ({ value: name, label: name })),
		{ value: "custom", label: "Enter custom model" },
	]);
	async function load() {
		const version = ++generation;
		loading.value = true;
		try {
			const result = await loadGroups();
			if (!disposed && version === generation && result.length) groups.value = result;
		} catch {
			// Keep the previous catalogue when the legacy optional model lookup fails.
		} finally {
			if (!disposed && version === generation) loading.value = false;
		}
	}
	function choose(value: string) {
		if (timer) clearTimeout(timer);
		if (value === "custom") {
			custom.value = true;
			selected.value = undefined;
		} else {
			custom.value = false;
			selected.value = value;
			onChange(value);
		}
	}
	function typeCustom(value: string) {
		customText.value = value;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			if (disposed) return;
			selected.value = value;
			onChange(value);
		}, 500);
	}
	return {
		selected,
		custom,
		customText,
		groups,
		loading,
		options,
		load,
		choose,
		typeCustom,
		setValue(value: string | undefined) {
			selected.value = value;
		},
		dispose() {
			disposed = true;
			++generation;
			if (timer) clearTimeout(timer);
		},
	};
}
